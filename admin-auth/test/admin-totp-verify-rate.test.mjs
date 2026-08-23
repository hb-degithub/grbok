import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// TOTP verify 限流编排测试：桩 security_rate_limit 为内存滑动窗口实现，
// 验证 admin_totp_security.js 的失败计数 / 锁定 / 成功不计数 / 统一错误文案语义。
// 限流库本身的窗口正确性由 tests/security-rate fixtures 覆盖。

const HOOK_PATH = new URL('../../pb_hooks/lib/admin_totp_security.js', import.meta.url);

function createRateLimitStub() {
  // policy -> subject -> number[] (event timestamps ms)
  const buckets = new Map();
  const policies = {
    admin_totp_verify: { limit: 5, windowSeconds: 300 },
    admin_totp_lockout: { limit: 1, windowSeconds: 900 },
  };
  function key(policy, subject) { return policy + '|' + subject; }
  function prune(events, nowMs, windowSeconds) {
    const cutoff = nowMs - windowSeconds * 1000;
    return events.filter((value) => value > cutoff);
  }
  class RateLimitUnavailableError extends Error {}
  return {
    RateLimitUnavailableError,
    consume(txDao, input) {
      const entry = input.entries[0];
      const policy = policies[entry.policyKey];
      const bucketKey = key(entry.policyKey, entry.subject);
      const events = prune(buckets.get(bucketKey) || [], input.nowMs, policy.windowSeconds);
      if (events.length >= policy.limit) {
        return { allowed: false, limitedBy: entry.policyKey, retryAfterSeconds: 1 };
      }
      events.push(input.nowMs);
      buckets.set(bucketKey, events);
      return { allowed: true, limitedBy: null, retryAfterSeconds: 0 };
    },
    _subjectHash(policy, subject) { return 'hash:' + policy + ':' + subject; },
    _parseEvents(raw) { return JSON.parse(raw || '[]'); },
    _pruneEvents(values, nowMs, windowSeconds) { return prune(values, nowMs, windowSeconds); },
    // 测试辅助：直接读取/清空底层桶
    _dump() { return buckets; },
    _reset() { buckets.clear(); },
  };
}

async function loadModule({ rateLimit, totpBehavior, auditRows, bucketRows }) {
  const source = await readFile(HOOK_PATH, 'utf8');
  const module = { exports: {} };
  const state = {
    id: 'totp-state-1',
    confirmed: true,
    lastUsed: -1,
    saved: false,
    get(field) { return field === 'last_used_timestep' ? state.lastUsed : undefined; },
    getString(field) {
      if (field === 'confirmed_at') return state.confirmed ? '2026-01-01 00:00:00' : '';
      if (field === 'revoked_at') return '';
      if (field === 'secret_enc') return 'enc-secret';
      return '';
    },
    set(field, value) { if (field === 'last_used_timestep') state.lastUsed = value; },
  };
  const dao = {
    findRecordsByFilter(collection, filter, sort, limit, offset, params) {
      if (collection === 'admin_totp_secrets') return [state];
      if (collection === 'security_rate_buckets') {
        // 只读锁定检查路径：依据 _subjectHash 结果匹配内存桶
        const hash = params && params.hash;
        const policy = params && params.policy;
        const events = (rateLimit._dump().get(policy + '|' + String(hash).replace('hash:' + policy + ':', '')) || []);
        if (!events.length) return [];
        return [{ get(field) { return field === 'events_json' ? JSON.stringify(events) : undefined; } }];
      }
      return [];
    },
    findCollectionByNameOrId() { return {}; },
    saveRecord(record) { if (record === state) state.saved = true; },
    runInTransaction(fn) { fn(dao); },
  };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    isFinite,
    ApiError: class ApiError extends Error {
      constructor(status, code) { super(code); this.status = status; this.code = code; }
    },
    Record: class Record {
      set() {}
      get() { return undefined; }
      getString() { return ''; }
    },
    readerToString() { return '{}'; },
    $os: {
      getenv(name) {
        if (name === 'ADMIN_AUTH_INTERNAL_SECRET') return 'test-internal-secret-32-chars!!!!!!';
        if (name === 'ADMIN_AUTH_INTERNAL_URL') return 'http://127.0.0.1:8787';
        return '';
      },
    },
    $app: { dao() { return dao; } },
    $security: {
      randomStringWithAlphabet() { return 'r'.repeat(22); },
      hs256(input) { return 'h:' + input; },
      equal(a, b) { return a === b; },
    },
    $http: { send() { return { statusCode: 200, raw: JSON.stringify({ record: {}, credential: 'cred' }) }; } },
    require(name) {
      if (name === './security_rate_limit.js') return rateLimit;
      if (name === './admin_totp.js') {
        return {
          decryptSecret() { return 'abcd'; },
          secretFromHex() { return []; },
          verifyCode: totpBehavior.verifyCode,
        };
      }
      if (name === './admin_security_audit.js') {
        return { writeSecurityAudit(daoArg, secureContext, event) { auditRows.push({ secureContext, event }); } };
      }
      if (name === './admin_step_up.js') return {};
      if (name === './client_ip.js') return { clientIp() { return '127.0.0.1'; } };
      return {};
    },
  });
  vm.runInContext(source, context, { filename: 'admin_totp_security.js' });
  return { security: module.exports, state };
}

function adminContext() {
  return {
    get(name) { return name === 'authRecord' ? adminContext.user : null; },
  };
}
adminContext.user = {
  id: 'admin-1',
  get(name) { return name === 'role' ? 'super_admin' : ''; },
  getString() { return ''; },
  verified() { return true; },
};

function requestContext() {
  return {
    get(name) { return name === 'authRecord' ? adminContext.user : null; },
    request() {
      return {
        header: { get() { return 'test-header'; } },
        body: null,
      };
    },
    json(status, payload) { return { status, payload }; },
  };
}

test('totp verify locks out after 5 failures and rejects while locked', async () => {
  const rateLimit = createRateLimitStub();
  const auditRows = [];
  const { security } = await loadModule({
    rateLimit,
    auditRows,
    totpBehavior: { verifyCode() { return { ok: false, timestep: -1, replay: false }; } },
  });

  // 前 4 次失败：TOTP_CODE_INVALID，未锁定
  for (let i = 0; i < 4; i++) {
    assert.throws(() => security.totpVerify(requestContext()), /TOTP_CODE_INVALID/);
  }
  assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_FAILED').length, 4);
  assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_LOCKED').length, 0);

  // 第 5 次失败：触发锁定（失败桶 5/300s 超限，写入锁定桶）
  assert.throws(() => security.totpVerify(requestContext()), /TOTP_CODE_INVALID/);
  const lockAudits = auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_LOCKED');
  assert.equal(lockAudits.length, 1);
  // 审计负载在 VM 上下文内构造，跨上下文对象不能用 deepStrictEqual 比较
  assert.equal(lockAudits[0].event.after.locked, true);
  assert.equal(lockAudits[0].event.after.reason, 'failure_threshold');

  // 锁定期间：直接拒绝，统一文案 TOTP_CODE_INVALID（不泄露锁定状态），不再消费失败桶
  const auditsBefore = auditRows.length;
  assert.throws(() => security.totpVerify(requestContext()), error => error && error.status === 400 && error.code === 'TOTP_CODE_INVALID');
  const newAudits = auditRows.slice(auditsBefore);
  assert.equal(newAudits.length, 1);
  assert.equal(newAudits[0].event.actionCode, 'ADMIN_TOTP_VERIFY_LOCKED');
  assert.equal(newAudits[0].event.after.locked, true);
});

test('totp verify success does not consume the failure bucket', async () => {
  const rateLimit = createRateLimitStub();
  const auditRows = [];
  const { security, state } = await loadModule({
    rateLimit,
    auditRows,
    totpBehavior: { verifyCode() { return { ok: true, timestep: 42, replay: false }; } },
  });

  // 连续 8 次成功（超过失败阈值 5）：不应被限流
  for (let i = 0; i < 8; i++) {
    const response = security.totpVerify(requestContext());
    assert.equal(response.status, 200);
    assert.equal(response.payload.verified, true);
  }
  // 防重放水线仍更新
  assert.equal(state.lastUsed, 42);
  assert.equal(state.saved, true);
  // 无失败/锁定审计，只有成功审计
  assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_FAILED').length, 0);
  assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_LOCKED').length, 0);
  assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_STEP_UP_VERIFIED').length, 8);
});

test('totp verify lockout expires after the lockout window', async () => {
  const rateLimit = createRateLimitStub();
  const auditRows = [];
  let now = 1000000;
  const realDateNow = Date.now;
  const { security } = await loadModule({
    rateLimit,
    auditRows,
    totpBehavior: { verifyCode() { return { ok: false, timestep: -1, replay: false }; } },
  });
  // 桩 Date.now 控制时间（vm 内共享宿主 Date）
  Date.now = () => now;
  try {
    for (let i = 0; i < 5; i++) {
      assert.throws(() => security.totpVerify(requestContext()), /TOTP_CODE_INVALID/);
    }
    // 锁定中
    assert.throws(() => security.totpVerify(requestContext()), /TOTP_CODE_INVALID/);
    assert.equal(auditRows.filter((row) => row.event.actionCode === 'ADMIN_TOTP_VERIFY_LOCKED').length, 2);

    // 推进 16 分钟：锁定桶（900s）与失败桶（300s）事件均过期
    now += 16 * 60 * 1000;
    assert.throws(() => security.totpVerify(requestContext()), /TOTP_CODE_INVALID/);
    const audits = auditRows.map((row) => row.event.actionCode);
    assert.equal(audits.filter((code) => code === 'ADMIN_TOTP_VERIFY_LOCKED').length, 2, 'no new lockout after expiry');
    assert.equal(audits.filter((code) => code === 'ADMIN_TOTP_VERIFY_FAILED').length, 6, 'failure counted again after lockout expiry');
  } finally {
    Date.now = realDateNow;
  }
});
