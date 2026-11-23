import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createChallenge as createLibChallenge, solveChallenge, verifySolution } from 'altcha-lib/v1';

// ALTCHA v1 协议实现测试（pb_hooks/lib/altcha.js）。
//
// 交叉验证策略（双向）：
//   1. 我们签发的 challenge + 解出的 number → 官方 altcha-lib/v1 verifySolution 必须接受；
//   2. 官方 altcha-lib/v1 createChallenge 签发的 payload → 我们的 verifyPayload 必须接受。
// 其余用例覆盖伪造 number / 签名 / challenge / salt、过期、重放、编码边界与 fail-closed。
//
// 依赖：admin-auth devDependency `altcha-lib@^2.10.0`（`import 'altcha-lib/v1'`）。
// 首次运行前：cd admin-auth && npm install --include=dev

const require = createRequire(import.meta.url);
const altcha = require('../../pb_hooks/lib/altcha.js');

const HMAC_KEY = 'captcha-unit-test-hmac-key-0123456789abcdef';
const OTHER_KEY = 'captcha-unit-test-other-key-abcdef0123456789';

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHexWith(key) {
  return (message) => createHmac('sha256', key).update(String(message), 'utf8').digest('hex');
}

const hmacHex = hmacHexWith(HMAC_KEY);

// 确定性"随机"源：salt 用 24 位 hex，number 用 12 位 hex（与生产实现同格式）。
// 返回 calls 让测试可以按实现同样的公式推导出服务端选的 number。
function createRandomHex() {
  let counter = 0;
  const calls = [];
  const fn = (length) => {
    counter += 1;
    const value = createHash('sha256').update('altcha-test-seed:' + counter).digest('hex').slice(0, length);
    assert.equal(value.length, length, 'randomHex length');
    calls.push(value);
    return value;
  };
  return { fn, calls };
}

// 与 altcha.js randomNumber() 同一公式：48 bit 取模 1..maxnumber。
function numberFromHex(hex, maxnumber) {
  const value = Number.parseInt(hex.slice(0, 6), 16) * 16777216 + Number.parseInt(hex.slice(6), 16);
  return (value % maxnumber) + 1;
}

function encodePayload(object) {
  return Buffer.from(JSON.stringify(object), 'utf8').toString('base64');
}

function issueChallenge(overrides = {}) {
  const random = createRandomHex();
  const hmacKey = overrides.hmacKey === undefined ? HMAC_KEY : overrides.hmacKey;
  // hmacHex 必须与 hmacKey 绑定（生产里 $security.hs256(message, ALTCHA_HMAC_KEY)），
  // 否则"换密钥必须失败"的用例会退化成"签名闭包仍用旧密钥"。
  const options = {
    maxnumber: 1000000,
    ttlSeconds: 600,
    now: Date.now(),
    randomHex: random.fn,
    sha256Hex,
    ...overrides,
    hmacKey,
    hmacHex: overrides.hmacHex || hmacHexWith(hmacKey),
  };
  const challenge = altcha.createChallenge(options);
  const number = numberFromHex(random.calls[1], challenge.maxnumber);
  return {
    challenge,
    number,
    payload: encodePayload({ ...challenge, number }),
    options,
  };
}

function verifyOptions(overrides = {}) {
  const hmacKey = overrides.hmacKey === undefined ? HMAC_KEY : overrides.hmacKey;
  return {
    now: Date.now(),
    sha256Hex,
    ...overrides,
    hmacKey,
    hmacHex: overrides.hmacHex || hmacHexWith(hmacKey),
  };
}

function assertReason(result, reason) {
  assert.equal(result.ok, false, 'expected rejection');
  assert.equal(result.reason, reason);
}

// ---------------------------------------------------------------------------
// challenge 生成
// ---------------------------------------------------------------------------

test('createChallenge 生成 ALTCHA v1 规范结构（SHA-256 / 24 位 hex salt / expires）', () => {
  const now = 1795000000000;
  const { challenge, number } = issueChallenge({ now, ttlSeconds: 600 });

  assert.deepEqual(Object.keys(challenge).sort(), ['algorithm', 'challenge', 'maxnumber', 'salt', 'signature']);
  assert.equal(challenge.algorithm, 'SHA-256');
  assert.equal(challenge.maxnumber, 1000000);
  assert.match(challenge.challenge, /^[0-9a-f]{64}$/);
  assert.match(challenge.signature, /^[0-9a-f]{64}$/);
  assert.match(challenge.salt, /^[0-9a-f]{24}\?expires=\d+&$/);

  const expires = Number(challenge.salt.split('?expires=')[1].replace('&', ''));
  assert.equal(expires, Math.floor(now / 1000) + 600);
  assert.equal(sha256Hex(challenge.salt + number), challenge.challenge);
  assert.equal(hmacHex(challenge.challenge), challenge.signature);
});

test('createChallenge 未配置 hmacKey 抛 CAPTCHA_UNCONFIGURED(503)', () => {
  const random = createRandomHex();
  assert.throws(
    () => altcha.createChallenge({
      hmacKey: '', randomHex: random.fn, sha256Hex, hmacHex,
    }),
    (error) => {
      assert.equal(error.name, 'CaptchaError');
      assert.equal(error.code, 'CAPTCHA_UNCONFIGURED');
      assert.equal(error.status, 503);
      return true;
    },
  );
});

test('createChallenge 默认 maxnumber=1000000、ttlSeconds=600', () => {
  const now = Date.now();
  const random = createRandomHex();
  const challenge = altcha.createChallenge({
    hmacKey: HMAC_KEY, now, randomHex: random.fn, sha256Hex, hmacHex,
  });
  assert.equal(challenge.maxnumber, 1000000);
  const expires = Number(challenge.salt.split('?expires=')[1].replace('&', ''));
  assert.equal(expires, Math.floor(now / 1000) + 600);
});

// ---------------------------------------------------------------------------
// 交叉验证 1：我们签发 → altcha-lib/v1 校验
// ---------------------------------------------------------------------------

test('altcha-lib/v1 verifySolution 接受我们签发的 payload（正向交叉验证）', async () => {
  const { payload } = issueChallenge();
  assert.equal(await verifySolution(payload, HMAC_KEY), true);
  assert.equal(await verifySolution(payload, OTHER_KEY), false);
});

test('客户端暴力搜索能解出我们签发的 challenge（客户端视角）', async () => {
  const { challenge, number } = issueChallenge();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber, number - 1).promise;
  assert.ok(solution, 'solution must be found');
  assert.equal(solution.number, number);

  const payload = encodePayload({ ...challenge, number: solution.number });
  assert.equal(await verifySolution(payload, HMAC_KEY), true);
  assert.deepEqual(altcha.verifyPayload(payload, verifyOptions()), { ok: true });
});

// ---------------------------------------------------------------------------
// 交叉验证 2：altcha-lib/v1 签发 → 我们校验
// ---------------------------------------------------------------------------

test('verifyPayload 接受 altcha-lib/v1 生成的 challenge（反向交叉验证）', async () => {
  const now = Date.now();
  const libChallenge = await createLibChallenge({
    hmacKey: HMAC_KEY,
    number: 4242,
    salt: 'abcdef0123456789abcdef01',
    expires: new Date(now + 10 * 60 * 1000),
    maxnumber: 1000000,
  });
  const payload = encodePayload({ ...libChallenge, number: 4242 });
  assert.deepEqual(altcha.verifyPayload(payload, verifyOptions({ now })), { ok: true });
  // 同一个 payload 换密钥必须失败
  assertReason(altcha.verifyPayload(payload, verifyOptions({ now, hmacKey: OTHER_KEY })), 'CAPTCHA_INVALID');
});

// ---------------------------------------------------------------------------
// 伪造/篡改
// ---------------------------------------------------------------------------

test('伪造 number → CAPTCHA_INVALID', () => {
  const { challenge, number } = issueChallenge();
  for (const forged of [number + 1, number - 1, 0]) {
    const payload = encodePayload({ ...challenge, number: forged });
    assertReason(altcha.verifyPayload(payload, verifyOptions()), 'CAPTCHA_INVALID');
  }
});

test('number 非整数（字符串 / 浮点 / 负数 / null）→ CAPTCHA_INVALID', () => {
  const { challenge, number } = issueChallenge();
  for (const forged of [String(number), number + 0.5, -1, null, undefined, [number], { value: number }]) {
    const payload = encodePayload({ ...challenge, number: forged });
    assertReason(altcha.verifyPayload(payload, verifyOptions()), 'CAPTCHA_INVALID');
  }
});

test('number 超出 maxnumber → CAPTCHA_INVALID', () => {
  const { challenge } = issueChallenge({ maxnumber: 1000 });
  const payload = encodePayload({ ...challenge, number: 1001 });
  assertReason(altcha.verifyPayload(payload, verifyOptions()), 'CAPTCHA_INVALID');
});

test('伪造 signature → CAPTCHA_INVALID', () => {
  const { challenge, number } = issueChallenge();
  const tampered = { ...challenge, number, signature: sha256Hex('not-a-signature') };
  assertReason(altcha.verifyPayload(encodePayload(tampered), verifyOptions()), 'CAPTCHA_INVALID');
});

test('伪造 challenge → CAPTCHA_INVALID', () => {
  const { challenge, number } = issueChallenge();
  const tampered = { ...challenge, number, challenge: sha256Hex('not-a-challenge') };
  assertReason(altcha.verifyPayload(encodePayload(tampered), verifyOptions()), 'CAPTCHA_INVALID');
});

test('篡改 salt（例如把 expires 推后）→ CAPTCHA_INVALID（salt 被 hash 覆盖）', () => {
  const { challenge, number } = issueChallenge();
  const extended = challenge.salt.replace(/expires=(\d+)/, (_, value) => 'expires=' + (Number(value) + 86400));
  assert.notEqual(extended, challenge.salt);
  const tampered = { ...challenge, number, salt: extended };
  assertReason(altcha.verifyPayload(encodePayload(tampered), verifyOptions()), 'CAPTCHA_INVALID');
});

test('algorithm 不是 SHA-256 → CAPTCHA_INVALID；大小写不敏感', () => {
  const { challenge, number } = issueChallenge();
  assertReason(
    altcha.verifyPayload(encodePayload({ ...challenge, number, algorithm: 'SHA-1' }), verifyOptions()),
    'CAPTCHA_INVALID',
  );
  assert.deepEqual(
    altcha.verifyPayload(encodePayload({ ...challenge, number, algorithm: 'sha-256' }), verifyOptions()),
    { ok: true },
  );
});

// ---------------------------------------------------------------------------
// 过期
// ---------------------------------------------------------------------------

test('过期 challenge → CAPTCHA_EXPIRED', () => {
  const issuedAt = Date.now() - 20 * 60 * 1000;
  const { payload } = issueChallenge({ now: issuedAt, ttlSeconds: 600 });
  const result = altcha.verifyPayload(payload, verifyOptions());
  assertReason(result, 'CAPTCHA_EXPIRED');
});

test('刚好在 expires 边界（now == expires）仍然有效，超过 1ms 即过期', () => {
  const now = 1795000000000;
  const { challenge, number, payload } = issueChallenge({ now, ttlSeconds: 600 });
  const expiresAtMs = (Math.floor(now / 1000) + 600) * 1000;

  assert.deepEqual(altcha.verifyPayload(payload, verifyOptions({ now: expiresAtMs, consumedSet: new Map() })), { ok: true });
  assertReason(
    altcha.verifyPayload(payload, verifyOptions({ now: expiresAtMs + 1, consumedSet: new Map() })),
    'CAPTCHA_EXPIRED',
  );
  // 边界两侧都不能绕过 number 校验
  assertReason(
    altcha.verifyPayload(encodePayload({ ...challenge, number: number + 1 }), verifyOptions({ now, consumedSet: new Map() })),
    'CAPTCHA_INVALID',
  );
});

// ---------------------------------------------------------------------------
// 重放
// ---------------------------------------------------------------------------

test('同一 payload 第二次提交 → CAPTCHA_REPLAY（consumedSet 用标准 Map）', () => {
  const { payload } = issueChallenge();
  const consumedSet = new Map();
  const options = verifyOptions({ consumedSet });

  assert.deepEqual(altcha.verifyPayload(payload, options), { ok: true });
  assert.equal(consumedSet.size, 1, 'challenge must be recorded once');
  assertReason(altcha.verifyPayload(payload, options), 'CAPTCHA_REPLAY');
});

test('createConsumedSet 是 Map 语义（has/add/size）且与 verifyPayload 协作', () => {
  const { payload } = issueChallenge();
  const set = altcha.createConsumedSet();
  const options = verifyOptions({ consumedSet: set });

  assert.equal(set.has('nope'), false);
  assert.deepEqual(altcha.verifyPayload(payload, options), { ok: true });
  assert.equal(set.size(), 1);
  assertReason(altcha.verifyPayload(payload, options), 'CAPTCHA_REPLAY');
});

test('createConsumedSet 按 expires 回收并保护容量上限', () => {
  const backing = {};
  let now = 1000;
  const set = altcha.createConsumedSet({ backing, maxEntries: 2, now: () => now });

  assert.equal(set.add('a', 2000), true);
  assert.equal(set.add('b', 3000), true);
  assert.equal(set.has('a'), true);
  // 满且没有可回收项 → 拒绝写入（调用方按"放行但暂时失去重放保护"处理）
  assert.equal(set.add('c', 4000), false);

  now = 2500; // 让 a 过期
  assert.equal(set.add('c', 4000), true);
  assert.equal(set.has('a'), false);
  assert.equal(set.has('b'), true);
  assert.equal(set.has('c'), true);
  assert.equal(set.size(), 2);

  now = 10000;
  set.sweep();
  assert.equal(set.size(), 0);
});

test('签名/哈希都正确但 challenge 已被消费时先报 REPLAY（不泄露内容）', () => {
  const { challenge, number, payload } = issueChallenge();
  const set = new Set([challenge.challenge]);
  const result = altcha.verifyPayload(payload, verifyOptions({ consumedSet: { has: (k) => set.has(k) } }));
  assertReason(result, 'CAPTCHA_REPLAY');
  // 未命中去重集时同一 payload 仍然有效
  assert.deepEqual(altcha.verifyPayload(payload, verifyOptions()), { ok: true });
  void number;
});

// ---------------------------------------------------------------------------
// 缺失 / 畸形 payload
// ---------------------------------------------------------------------------

test('缺失或空 payload → CAPTCHA_REQUIRED', () => {
  for (const empty of ['', undefined, null, false]) {
    assertReason(altcha.verifyPayload(empty, verifyOptions()), 'CAPTCHA_REQUIRED');
  }
});

test('非 base64 / 非 JSON / 非对象 JSON → CAPTCHA_INVALID', () => {
  for (const garbage of ['!!!not-base64!!!', 'a', Buffer.from('not json', 'utf8').toString('base64'),
    Buffer.from('[1,2,3]', 'utf8').toString('base64'), Buffer.from('null', 'utf8').toString('base64'),
    Buffer.from('"text"', 'utf8').toString('base64')]) {
    assertReason(altcha.verifyPayload(garbage, verifyOptions()), 'CAPTCHA_INVALID');
  }
});

test('salt 形态非法（缺 expires / 缺 & / 长度不符 / 大写）→ CAPTCHA_INVALID', () => {
  const { challenge, number } = issueChallenge();
  for (const salt of [
    'abcdef0123456789abcdef01',
    'abcdef0123456789abcdef01?expires=1795000000',
    'abcdef0123456789abcdef01?expires=1795000000&x=1',
    'ABCDEF0123456789ABCDEF01?expires=1795000000&',
    'abc?expires=1795000000&',
    'abcdef0123456789abcdef01?expires=notanumber&',
  ]) {
    const payload = encodePayload({ ...challenge, number, salt });
    assertReason(altcha.verifyPayload(payload, verifyOptions()), 'CAPTCHA_INVALID');
  }
});

test('超长 payload（> 4096 字符）→ CAPTCHA_INVALID', () => {
  const payload = 'A'.repeat(4097);
  assertReason(altcha.verifyPayload(payload, verifyOptions()), 'CAPTCHA_INVALID');
});

test('未配置 hmacKey 时 verifyPayload fail-closed（绝不返回 ok）', () => {
  const { payload } = issueChallenge();
  const result = altcha.verifyPayload(payload, { hmacKey: '', now: Date.now(), sha256Hex, hmacHex });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// 编码 / 工具函数
// ---------------------------------------------------------------------------

test('base64Decode 兼容标准表、URL-safe、省略 padding 与 UTF-8', () => {
  const json = JSON.stringify({ salt: 'abcdef0123456789abcdef01?expires=1&', note: '中文 ok' });
  const standard = Buffer.from(json, 'utf8').toString('base64');
  const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  assert.equal(altcha.base64Decode(standard), json);
  assert.equal(altcha.base64Decode(urlSafe), json);
  assert.equal(altcha.base64Decode(''), '');
  assert.throws(() => altcha.base64Decode('abc$'), /CAPTCHA_INVALID|invalid base64/);
  assert.throws(() => altcha.base64Decode('a'), /CAPTCHA_INVALID|invalid base64/);
});

test('constantTimeEqual 行为与长度差异', () => {
  assert.equal(altcha.constantTimeEqual('abc', 'abc'), true);
  assert.equal(altcha.constantTimeEqual('abc', 'abd'), false);
  assert.equal(altcha.constantTimeEqual('abc', 'abcd'), false);
  assert.equal(altcha.constantTimeEqual('', ''), true);
  assert.equal(altcha.constantTimeEqual(null, 'abc'), false);
});

test('verifyPayload 支持注入自定义 base64Decode', () => {
  const { payload } = issueChallenge();
  let calls = 0;
  const base64Decode = (value) => {
    calls += 1;
    return altcha.base64Decode(value);
  };
  assert.deepEqual(altcha.verifyPayload(payload, verifyOptions({ base64Decode })), { ok: true });
  assert.equal(calls, 1);
});

test('导出常量与协议 reason 名称稳定（供 hook 引用）', () => {
  assert.equal(altcha.CAPTCHA_REQUIRED, 'CAPTCHA_REQUIRED');
  assert.equal(altcha.CAPTCHA_INVALID, 'CAPTCHA_INVALID');
  assert.equal(altcha.CAPTCHA_EXPIRED, 'CAPTCHA_EXPIRED');
  assert.equal(altcha.CAPTCHA_REPLAY, 'CAPTCHA_REPLAY');
  assert.equal(altcha.ALGORITHM, 'SHA-256');
  assert.equal(altcha.DEFAULT_MAXNUMBER, 1000000);
});

// ---------------------------------------------------------------------------
// 限流策略表一致性（captcha_challenge_ip 签发配额 + captcha_challenge_use 一次性去重）
// ---------------------------------------------------------------------------

test('captcha 策略键在 DEFAULTS/BOUNDS 中成对存在且默认值落在边界内', () => {
  const store = require('../../pb_hooks/lib/security_policy_store.js');
  const defaults = Object.keys(store.DEFAULTS);
  const bounds = Object.keys(store.BOUNDS);

  // 两个集合必须完全一致：只加 DEFAULTS 不加 BOUNDS 会让整组策略 fail-closed。
  assert.deepEqual(defaults.slice().sort(), bounds.slice().sort());
  for (const key of defaults) {
    const value = store.DEFAULTS[key];
    const bound = store.BOUNDS[key];
    assert.ok(value.limit >= bound.minLimit && value.limit <= bound.maxLimit, key + ' limit out of bounds');
    assert.ok(
      value.windowSeconds >= bound.minWindow && value.windowSeconds <= bound.maxWindow,
      key + ' window out of bounds',
    );
  }

  assert.deepEqual(store.DEFAULTS.captcha_challenge_ip, { limit: 60, windowSeconds: 60 });
  // 一次性 consume 必须恒为 1 次，窗口覆盖 challenge TTL（600s）。
  assert.deepEqual(store.DEFAULTS.captcha_challenge_use, { limit: 1, windowSeconds: 600 });
  assert.equal(store.BOUNDS.captcha_challenge_use.minLimit, 1);
  assert.equal(store.BOUNDS.captcha_challenge_use.maxLimit, 1);
  assert.equal(store.BOUNDS.captcha_challenge_use.minWindow, 600);
  assert.equal(store.BOUNDS.captcha_challenge_use.maxWindow, 600);
});

test('配套迁移注册的键与 DEFAULTS 新增键一致（代码与迁移必须同批上线）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('../../pb_migrations/20261123150000_add_captcha_rate_policy.pb.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /captcha_challenge_ip:\s*\[60,\s*60\]/);
  assert.match(source, /captcha_challenge_use:\s*\[1,\s*600\]/);
  // 回滚分支必须同时删除两行，否则回滚后策略组行数对不上 → 全站限流 503。
  assert.match(source, /keys = \['captcha_challenge_ip', 'captcha_challenge_use'\]/);
});
