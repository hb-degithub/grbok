'use strict';

// ============================================================================
// ALTCHA v1 Proof-of-Work 人机校验（协议实现 + PocketBase 运行时胶水）
// ============================================================================
//
// 协议（与 npm `altcha@2.x` 浏览器组件、`altcha-lib/v1` 服务端库完全一致）：
//
//   服务端签发 challenge：
//     salt      = <24 位小写 hex>?expires=<unix 秒>&
//     number    = 1..maxnumber 的整数（客户端要暴力搜索的目标）
//     challenge = sha256(salt + number)                        —— lowercase hex
//     signature = hmac_sha256(key = ALTCHA_HMAC_KEY, message = challenge)
//
//   客户端提交：
//     payload = base64(JSON.stringify({
//       algorithm, challenge, number, salt, maxnumber, signature,
//     }))
//     —— 浏览器组件的表单字段名固定为 `altcha`。
//
//   服务端校验：base64 解码 → number 必须是整数 → 从 salt 的 ?expires= 取过期时间
//   → 重算 sha256(salt + number) 与 hmac_sha256(challenge) → 常数时间比较两处
//   → 一次性 challenge 去重（防重放）。
//
// 设计约束（Task: 不新增常驻服务，全部在现有 PB 进程内完成）：
//   * crypto / 随机源 / base64 全部依赖注入，本文件同时可在 Node（node --test +
//     altcha-lib/v1 交叉验证）与 Goja（$security.sha256 / $security.hs256）复用；
//   * 不新增数据库表/常驻服务：一次性 challenge 去重复用现有持久化限流表
//     security_rate_buckets（策略键 captcha_challenge_use，1 次 / 600s）；
//     原因见下方"跨请求状态"一节 —— PB 0.22 的 globalThis 不跨请求保留；
//   * 未配置 ALTCHA_HMAC_KEY 时 requireCaptcha 显式放行并告警（本地开发/回滚安全，
//     生产必须先设置该变量；/api/captcha/challenge 在未配置时返回 503）。
//
// Goja 兼容：只用 var/function，无 async/await、无 optional chaining、无 atob。
// ============================================================================

var ALGORITHM = 'SHA-256';
var DEFAULT_MAXNUMBER = 1000000;
var DEFAULT_TTL_SECONDS = 600;
var SALT_HEX_LENGTH = 24;
var NUMBER_RANDOM_HEX_LENGTH = 12;
var MAX_PAYLOAD_CHARS = 4096;
var MAX_CONSUMED_ENTRIES = 20000;
var CONSUMED_SWEEP_INTERVAL_MS = 30 * 1000;
var REJECT_LOG_INTERVAL_MS = 10 * 1000;
var UNCONFIGURED_LOG_INTERVAL_MS = 60 * 1000;

var HEX64_RE = /^[0-9a-f]{64}$/;
var LOWER_HEX_RE = /^[0-9a-f]+$/;
// 协议里 salt 的固定形态：24 位小写 hex + "?expires=<unix 秒>" + "&"。
// expires 在 salt 内、而 signature 只覆盖 challenge —— 篡改 expires 需要重新做 PoW
// （预映像），因此严格格式校验只是把畸形/异常 payload 提前挡掉。
var SALT_RE = /^([0-9a-f]{24})\?expires=([0-9]{1,12})&$/;

var CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED';
var CAPTCHA_INVALID = 'CAPTCHA_INVALID';
var CAPTCHA_EXPIRED = 'CAPTCHA_EXPIRED';
var CAPTCHA_REPLAY = 'CAPTCHA_REPLAY';
var CAPTCHA_UNCONFIGURED = 'CAPTCHA_UNCONFIGURED';
var CAPTCHA_UNAVAILABLE = 'CAPTCHA_UNAVAILABLE';

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

// 供 Node 侧 / 调用方识别的协议错误（createChallenge 的入参错误）。
function codedError(code, status, message) {
  var error = new Error(message || code);
  error.name = 'AltchaError';
  error.code = code;
  error.status = status || 400;
  return error;
}

// requireCaptcha / challengeHandler 抛出的错误：带 HTTP 语义。
function captchaError(code, status, message) {
  var error = codedError(code, status, message);
  error.name = 'CaptchaError';
  return error;
}

function isCaptchaError(error) {
  return Boolean(error && error.name === 'CaptchaError');
}

// 把 requireCaptcha 的错误收敛成 { status, code }；非 captcha 错误返回 null。
function captchaFailure(error) {
  if (!isCaptchaError(error)) return null;
  var status = Number(error.status);
  if (!Number.isSafeInteger(status) || status < 400 || status > 599) status = 400;
  return { status: status, code: String(error.code || CAPTCHA_INVALID) };
}

function invalidResult() {
  return { ok: false, reason: CAPTCHA_INVALID };
}

// ---------------------------------------------------------------------------
// base64 / UTF-8（Goja 没有 atob / TextDecoder）
// ---------------------------------------------------------------------------

var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var B64_LOOKUP = null;

function b64Lookup() {
  if (B64_LOOKUP) return B64_LOOKUP;
  var table = {};
  for (var i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charAt(i)] = i;
  // 宽容接受 URL-safe 变体（btoa 产物是标准表，这里只是避免无谓的 400）。
  table['-'] = 62;
  table['_'] = 63;
  B64_LOOKUP = table;
  return table;
}

function utf8Decode(bytes) {
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var first = bytes[i];
    i++;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      continue;
    }
    var extra = 0;
    var codePoint = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      extra = 1;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      extra = 2;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      extra = 3;
      codePoint = first & 0x07;
    } else {
      throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid utf-8 sequence');
    }
    if (i + extra > bytes.length) throw codedError(CAPTCHA_INVALID, 400, 'altcha: truncated utf-8 sequence');
    for (var n = 0; n < extra; n++) {
      var next = bytes[i];
      i++;
      if ((next & 0xc0) !== 0x80) throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid utf-8 continuation');
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid utf-8 code point');
    }
    if (codePoint > 0xffff) {
      codePoint -= 0x10000;
      out += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    } else {
      out += String.fromCharCode(codePoint);
    }
  }
  return out;
}

// 纯 JS base64 解码（标准表 + URL-safe，允许省略 padding）。
// 非法输入抛 AltchaError(CAPTCHA_INVALID)；调用方按 CAPTCHA_INVALID 处理。
function base64Decode(input) {
  if (typeof input !== 'string') throw codedError(CAPTCHA_INVALID, 400, 'altcha: base64 input must be a string');
  var text = input.replace(/[\s]+/g, '');
  var end = text.length;
  while (end > 0 && text.charAt(end - 1) === '=') end--;
  if (text.length - end > 2) throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid base64 padding');
  for (var p = 0; p < end; p++) {
    if (text.charAt(p) === '=') throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid base64 padding');
  }
  text = text.slice(0, end);
  if (text.length % 4 === 1) throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid base64 length');

  var lookup = b64Lookup();
  var bytes = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < text.length; i++) {
    var value = lookup[text.charAt(i)];
    if (value === undefined) throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid base64 character');
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // 尾部残留位必须为 0（非规范编码 = 被篡改的 payload）。
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw codedError(CAPTCHA_INVALID, 400, 'altcha: invalid base64 trailing bits');
  }
  return utf8Decode(bytes);
}

// ---------------------------------------------------------------------------
// 常数时间比较（hex 串）
// ---------------------------------------------------------------------------

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  var mismatch = left.length ^ right.length;
  var length = left.length > right.length ? left.length : right.length;
  for (var i = 0; i < length; i++) {
    var a = i < left.length ? left.charCodeAt(i) : 0;
    var b = i < right.length ? right.charCodeAt(i) : 0;
    mismatch = mismatch | (a ^ b);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// 一次性 challenge 去重集（防重放）
// ---------------------------------------------------------------------------

function createConsumedSet(options) {
  var opts = options || {};
  var backing = opts.backing;
  if (!backing || typeof backing !== 'object') backing = {};
  var maxEntries = Number.isSafeInteger(opts.maxEntries) && opts.maxEntries > 0
    ? opts.maxEntries
    : MAX_CONSUMED_ENTRIES;
  var lastSweepAt = 0;

  function clockNow() {
    if (typeof opts.now === 'function') {
      var supplied = Number(opts.now());
      if (Number.isSafeInteger(supplied) && supplied >= 0) return supplied;
    }
    return Date.now();
  }

  function sweepAt(nowMs) {
    lastSweepAt = nowMs;
    var keys = Object.keys(backing);
    var removed = 0;
    for (var i = 0; i < keys.length; i++) {
      if (Number(backing[keys[i]]) <= nowMs) {
        delete backing[keys[i]];
        removed++;
      }
    }
    return removed;
  }

  return {
    backing: backing,
    has: function (challenge) {
      return Object.prototype.hasOwnProperty.call(backing, String(challenge));
    },
    // 返回 false 表示去重集已满且无法回收（调用方按"放行但失去重放保护"处理）。
    add: function (challenge, expiresAtMs) {
      var nowMs = clockNow();
      if (nowMs - lastSweepAt >= CONSUMED_SWEEP_INTERVAL_MS) sweepAt(nowMs);
      if (Object.keys(backing).length >= maxEntries) sweepAt(nowMs);
      if (Object.keys(backing).length >= maxEntries) return false;
      var key = String(challenge);
      var expires = Number(expiresAtMs);
      backing[key] = Number.isSafeInteger(expires) && expires > 0
        ? expires
        : nowMs + DEFAULT_TTL_SECONDS * 1000;
      return true;
    },
    size: function () { return Object.keys(backing).length; },
    sweep: function () { return sweepAt(clockNow()); },
    clear: function () {
      var keys = Object.keys(backing);
      for (var i = 0; i < keys.length; i++) delete backing[keys[i]];
    },
  };
}

// ---------------------------------------------------------------------------
// challenge 生成
// ---------------------------------------------------------------------------

// 从注入的 randomHex 取 48 bit 随机量，落在 1..maxnumber。
// maxnumber <= 1e6 时取模偏差 < 2^-28，远低于 PoW 本身的可忽略量级。
function randomNumber(maxnumber, randomHex) {
  var raw = String(randomHex(NUMBER_RANDOM_HEX_LENGTH) || '');
  if (raw.length !== NUMBER_RANDOM_HEX_LENGTH || !LOWER_HEX_RE.test(raw)) {
    throw new Error('altcha: randomHex must return ' + NUMBER_RANDOM_HEX_LENGTH + ' lowercase hex chars');
  }
  var high = parseInt(raw.slice(0, 6), 16);
  var low = parseInt(raw.slice(6), 16);
  if (!Number.isSafeInteger(high) || !Number.isSafeInteger(low)) throw new Error('altcha: randomHex produced non-hex input');
  var value = high * 16777216 + low; // 2^48，仍在 Number.MAX_SAFE_INTEGER 内
  return (value % maxnumber) + 1;
}

/**
 * createChallenge(opts)
 *   opts = {
 *     hmacKey     必填，ALTCHA_HMAC_KEY（仅用于校验/报错，签名由 hmacHex 传入）
 *     maxnumber   可选，默认 1000000
 *     ttlSeconds  可选，默认 600（salt 里的 expires 窗口）
 *     now         可选，毫秒时间戳，默认 Date.now()
 *     randomHex   function(length) -> 小写 hex 串（PB: $security.randomStringWithAlphabet）
 *     sha256Hex   function(text)   -> 小写 hex（PB: $security.sha256）
 *     hmacHex     function(message)-> 小写 hex，key 已绑定（PB: $security.hs256(message, key)）
 *   }
 * 返回 { algorithm, challenge, maxnumber, salt, signature } —— 即 challenge 接口响应体。
 */
function createChallenge(options) {
  var opts = options || {};
  var hmacKey = typeof opts.hmacKey === 'string' ? opts.hmacKey : '';
  if (!hmacKey) throw captchaError(CAPTCHA_UNCONFIGURED, 503, 'ALTCHA_HMAC_KEY is not configured');

  var sha256Hex = opts.sha256Hex;
  var hmacHex = opts.hmacHex;
  var randomHex = opts.randomHex;
  if (typeof sha256Hex !== 'function' || typeof hmacHex !== 'function' || typeof randomHex !== 'function') {
    throw new Error('altcha: sha256Hex, hmacHex and randomHex are required');
  }

  var maxnumber = opts.maxnumber === undefined ? DEFAULT_MAXNUMBER : Number(opts.maxnumber);
  if (!Number.isSafeInteger(maxnumber) || maxnumber < 1 || maxnumber > 2147483647) maxnumber = DEFAULT_MAXNUMBER;

  var now = opts.now === undefined ? Date.now() : Number(opts.now);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('altcha: now must be a non-negative integer (ms)');

  var ttlSeconds = opts.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : Number(opts.ttlSeconds);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) ttlSeconds = DEFAULT_TTL_SECONDS;

  var expiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;

  var saltHex = String(randomHex(SALT_HEX_LENGTH) || '');
  if (saltHex.length !== SALT_HEX_LENGTH || !LOWER_HEX_RE.test(saltHex)) {
    throw new Error('altcha: randomHex must return ' + SALT_HEX_LENGTH + ' lowercase hex chars');
  }
  var salt = saltHex + '?expires=' + String(expiresAtSeconds) + '&';

  var number = randomNumber(maxnumber, randomHex);

  var challenge = String(sha256Hex(salt + String(number)) || '').toLowerCase();
  if (!HEX64_RE.test(challenge)) throw new Error('altcha: sha256Hex must return 64 hex chars');

  var signature = String(hmacHex(challenge) || '').toLowerCase();
  if (!HEX64_RE.test(signature)) throw new Error('altcha: hmacHex must return 64 hex chars');

  return {
    algorithm: ALGORITHM,
    challenge: challenge,
    maxnumber: maxnumber,
    salt: salt,
    signature: signature,
  };
}

// ---------------------------------------------------------------------------
// payload 校验
// ---------------------------------------------------------------------------

/**
 * verifyPayload(payloadBase64, opts)
 *   opts = {
 *     hmacKey      必填；为空时一律返回 ok:false（fail-closed，绝不静默放行）
 *     now          可选，毫秒时间戳，默认 Date.now()
 *     sha256Hex    function(text)   -> 小写 hex
 *     hmacHex      function(message)-> 小写 hex（key 已绑定）
 *     base64Decode 可选，默认本模块的纯 JS 解码器
 *     consumedSet  可选，Map 语义（has/add）；用于一次性 challenge 去重
 *   }
 * 返回 { ok: true } 或 { ok: false, reason: CAPTCHA_REQUIRED|CAPTCHA_INVALID|CAPTCHA_EXPIRED|CAPTCHA_REPLAY }
 */
function verifyPayload(payloadBase64, options) {
  var opts = options || {};
  var hmacKey = typeof opts.hmacKey === 'string' ? opts.hmacKey : '';
  if (!hmacKey) return invalidResult();
  if (typeof opts.sha256Hex !== 'function' || typeof opts.hmacHex !== 'function') {
    throw new Error('altcha: sha256Hex and hmacHex are required');
  }

  var now = opts.now === undefined ? Date.now() : Number(opts.now);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('altcha: now must be a non-negative integer (ms)');

  if (typeof payloadBase64 !== 'string' || !payloadBase64) {
    return { ok: false, reason: CAPTCHA_REQUIRED };
  }
  if (payloadBase64.length > MAX_PAYLOAD_CHARS) return invalidResult();

  var decode = typeof opts.base64Decode === 'function' ? opts.base64Decode : base64Decode;

  var decoded = null;
  try {
    decoded = decode(payloadBase64);
  } catch (_) {
    return invalidResult();
  }
  if (typeof decoded !== 'string' || !decoded) return invalidResult();

  var payload = null;
  try {
    payload = JSON.parse(decoded);
  } catch (_) {
    return invalidResult();
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalidResult();

  var algorithm = String(payload.algorithm === undefined ? '' : payload.algorithm).toUpperCase();
  if (algorithm !== ALGORITHM) return invalidResult();

  var challenge = typeof payload.challenge === 'string' ? payload.challenge : '';
  var salt = typeof payload.salt === 'string' ? payload.salt : '';
  var signature = typeof payload.signature === 'string' ? payload.signature : '';
  if (!HEX64_RE.test(challenge) || !HEX64_RE.test(signature)) return invalidResult();

  // number 必须是整数：任何字符串形态都可能把 "&" 之类的分隔符拼进被签名的
  // salt/number 边界（altcha-lib v1 的 createChallenge 对同一攻击做了同样拦截）。
  if (typeof payload.number !== 'number' || !Number.isSafeInteger(payload.number) || payload.number < 0) {
    return invalidResult();
  }

  var maxnumber = payload.maxnumber === undefined ? DEFAULT_MAXNUMBER : Number(payload.maxnumber);
  if (!Number.isSafeInteger(maxnumber) || maxnumber < 1) return invalidResult();
  if (payload.number > maxnumber) return invalidResult();

  var saltMatch = SALT_RE.exec(salt);
  if (!saltMatch) return invalidResult();
  var expiresAtSeconds = parseInt(saltMatch[2], 10);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds < 1) return invalidResult();

  var expiresAtMs = expiresAtSeconds * 1000;
  if (now > expiresAtMs) return { ok: false, reason: CAPTCHA_EXPIRED };

  // 重算 sha256(salt + number)：两处比较都用常数时间实现。
  var expectedChallenge = String(opts.sha256Hex(salt + String(payload.number)) || '').toLowerCase();
  if (!constantTimeEqual(expectedChallenge, challenge)) return invalidResult();

  var expectedSignature = String(opts.hmacHex(challenge) || '').toLowerCase();
  if (!constantTimeEqual(expectedSignature, signature)) return invalidResult();

  // 重放检查放在密码学校验之后：攻击者不能凭任意 challenge 值污染去重集。
  // 去重集只要求 Map 语义的 has()，写入接受 add()（本模块 createConsumedSet）或
  // set()（标准 Map）——测试里直接传 new Map() 也能用。
  var consumedSet = opts.consumedSet;
  if (consumedSet && typeof consumedSet.has === 'function') {
    if (consumedSet.has(challenge)) return { ok: false, reason: CAPTCHA_REPLAY };
    var recorded = true;
    if (typeof consumedSet.add === 'function') {
      recorded = consumedSet.add(challenge, expiresAtMs) !== false;
    } else if (typeof consumedSet.set === 'function') {
      consumedSet.set(challenge, expiresAtMs);
    }
    if (!recorded) {
      // 去重集已满且无可回收项：放行（可用性优先），代价是这段时间内失去重放保护。
      throttledWarn('consumed-full', REJECT_LOG_INTERVAL_MS, '[captcha] operation=consumed-set result=FULL');
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// PocketBase 运行时胶水（仅在 PB 内调用；Node 测试只 require 上方的纯函数）
// ---------------------------------------------------------------------------
//
// 跨请求状态为什么不用 globalThis / 模块级变量（PB 0.22.21 实测，勿删这段结论）：
//   * routerAdd / 事件回调每次请求都在**新的 goja runtime** 中执行：globalThis 写入
//     不跨请求保留（`--hooksPool=1` 也一样：请求 1 写入的计数器在请求 2 仍是 1）。
//     因此"内存 Map"在本项目里对**跨请求**重放没有任何防护效果。
//   * `$app.cache()` 是 tools/store.Store：`set(key, value)` 没有 TTL 参数
//     （第三个数字参数被忽略），也不适合做带过期的去重集。
//   * 与 login_security_lib.js 的历史结论一致：跨请求安全状态必须落在
//     security_rate_buckets（security_rate_limit.consume）——只有它带 TTL、事务原子性，
//     并且由 security_rate_cleanup.pb.js 的小时级 cron 清理。
//
// 所以一次性 challenge 去重 = 策略键 captcha_challenge_use
// （limit=1 / windowSeconds=600 = challenge TTL），subject = challenge hex；
// 第二次提交同一 payload 时 consume() 返回 allowed=false → CAPTCHA_REPLAY。
// verifyPayload 仍保留 consumedSet 注入点（纯函数测试与其它调用方可自行传入）。

var CHALLENGE_USE_POLICY = 'captcha_challenge_use';
var LOG_THROTTLE_CACHE_PREFIX = 'altcha.log.';

function hmacKeyFromEnv() {
  try {
    return String($os.getenv('ALTCHA_HMAC_KEY') || '').trim();
  } catch (_) {
    return '';
  }
}

// 日志节流：$app.cache() 无 TTL，但这里只需要"最近一次打印时间"，
// 键空间固定（每种 reason 一个），不会无限增长。
function throttledWarn(stateKey, intervalMs, line) {
  var now = Date.now();
  try {
    if (typeof $app !== 'undefined' && $app && typeof $app.cache === 'function') {
      var cache = $app.cache();
      var key = LOG_THROTTLE_CACHE_PREFIX + stateKey;
      var last = Number(cache.get(key) || 0);
      if (last && now - last < intervalMs) return;
      cache.set(key, now);
    }
  } catch (_) {}
  console.warn(line);
}

function requestPath(c) {
  try {
    var url = c.request().url;
    return String((url && url.path) || '');
  } catch (_) {
    return '';
  }
}

function securityOptions(hmacKey) {
  return {
    hmacKey: hmacKey,
    now: Date.now(),
    sha256Hex: function (text) { return $security.sha256(text); },
    // 注意 $security.hs256 的签名是 hs256(data, key)：data 在前、key 在后。
    hmacHex: function (message) { return $security.hs256(message, hmacKey); },
  };
}

// 从已通过校验的 payload 中取出 challenge（用于一次性标记的 subject）。
function challengeFromPayload(payloadBase64) {
  try {
    var parsed = JSON.parse(base64Decode(payloadBase64));
    if (parsed && typeof parsed.challenge === 'string') return parsed.challenge;
  } catch (_) {}
  return '';
}

// 消耗一次性 challenge 标记：首次返回 true，重复提交返回 false。
// 存储不可用（策略表降级 / MAIL_HASH_SECRET 缺失 / SQLite 故障）→ 503 CAPTCHA_UNAVAILABLE（fail-closed）。
function consumeChallengeUse(challenge) {
  var decision = null;
  try {
    var rateLimit = require('./security_rate_limit.js');
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: CHALLENGE_USE_POLICY, subject: String(challenge) }],
      });
    });
  } catch (error) {
    console.error('[captcha] operation=replay-store result=UNAVAILABLE name=' + String((error && error.name) || 'Error'));
    throw captchaError(CAPTCHA_UNAVAILABLE, 503);
  }
  if (!decision || typeof decision.allowed !== 'boolean') {
    console.error('[captcha] operation=replay-store result=UNAVAILABLE reason=INVALID_DECISION');
    throw captchaError(CAPTCHA_UNAVAILABLE, 503);
  }
  return decision.allowed === true;
}

/**
 * 供 4 个发信接口调用的共用校验入口。
 *   - ALTCHA_HMAC_KEY 未配置：记一次节流警告并放行（本地开发/回滚安全）；
 *   - 校验失败 / 重放：抛 CaptchaError（error.code = CAPTCHA_*, error.status = 400）；
 *   - 存储不可用：抛 CaptchaError(CAPTCHA_UNAVAILABLE, 503)；
 *   - 通过：返回 { ok: true, skipped: false }。
 */
function requireCaptcha(c, body) {
  var hmacKey = hmacKeyFromEnv();
  if (!hmacKey) {
    throttledWarn('unconfigured', UNCONFIGURED_LOG_INTERVAL_MS,
      '[captcha] operation=verify result=SKIPPED reason=ALTCHA_HMAC_KEY_MISSING path=' + requestPath(c));
    return { ok: true, skipped: true };
  }

  var field = body && typeof body === 'object' ? body.altcha : '';
  var payload = typeof field === 'string' ? field : '';

  var result = verifyPayload(payload, securityOptions(hmacKey));
  if (!result.ok) {
    throttledWarn('verify:' + result.reason, REJECT_LOG_INTERVAL_MS,
      '[captcha] operation=verify result=' + result.reason + ' path=' + requestPath(c));
    throw captchaError(result.reason, 400);
  }

  // 重放检查放在密码学校验之后：攻击者不能凭任意 challenge 值污染去重表。
  var challenge = challengeFromPayload(payload);
  if (!challenge) throw captchaError(CAPTCHA_INVALID, 400);
  if (!consumeChallengeUse(challenge)) {
    throttledWarn('verify:' + CAPTCHA_REPLAY, REJECT_LOG_INTERVAL_MS,
      '[captcha] operation=verify result=' + CAPTCHA_REPLAY + ' path=' + requestPath(c));
    throw captchaError(CAPTCHA_REPLAY, 400);
  }
  return { ok: true, skipped: false };
}

/**
 * GET /api/captcha/challenge 的完整处理逻辑（captcha.pb.js 只做薄注册）。
 *   未配置密钥 → 503 CAPTCHA_UNCONFIGURED
 *   限流命中   → 429 CAPTCHA_RATE_LIMITED（带 retryAfter）
 *   限流不可用 → 503 CAPTCHA_UNAVAILABLE（fail-closed，与其余安全端点一致）
 */
function challengeHandler(c, options) {
  var opts = options || {};
  try {
    c.response().header().set('Cache-Control', 'no-store');
    c.response().header().set('Pragma', 'no-cache');
  } catch (_) {}

  var hmacKey = hmacKeyFromEnv();
  if (!hmacKey) {
    throttledWarn('unconfigured-challenge', UNCONFIGURED_LOG_INTERVAL_MS,
      '[captcha] operation=challenge result=UNCONFIGURED reason=ALTCHA_HMAC_KEY_MISSING');
    return c.json(503, { code: CAPTCHA_UNCONFIGURED });
  }

  var decision = null;
  var limited = false;
  var unavailable = false;
  try {
    var ip = '';
    try {
      ip = require('./security_rate_limit.js').normalizeIp(require('./client_ip.js').clientIp(c));
    } catch (_) {
      ip = '';
    }
    if (ip) {
      var rateLimit = require('./security_rate_limit.js');
      $app.dao().runInTransaction(function (txDao) {
        decision = rateLimit.consume(txDao, {
          nowMs: Date.now(),
          entries: [{ policyKey: 'captcha_challenge_ip', subject: ip }],
        });
      });
      if (!decision || typeof decision.allowed !== 'boolean') unavailable = true;
      else if (!decision.allowed) limited = true;
    }
  } catch (error) {
    console.error('[captcha] operation=challenge-ratelimit result=UNAVAILABLE name=' + String((error && error.name) || 'Error'));
    unavailable = true;
  }

  if (unavailable) return c.json(503, { code: CAPTCHA_UNAVAILABLE });
  if (limited) {
    return c.json(429, {
      code: 'CAPTCHA_RATE_LIMITED',
      retryAfter: Math.max(1, Number(decision.retryAfterSeconds) || 1),
    });
  }

  var challenge = createChallenge({
    hmacKey: hmacKey,
    maxnumber: opts.maxnumber,
    ttlSeconds: opts.ttlSeconds,
    now: Date.now(),
    randomHex: function (length) { return $security.randomStringWithAlphabet(length, '0123456789abcdef'); },
    sha256Hex: function (text) { return $security.sha256(text); },
    hmacHex: function (message) { return $security.hs256(message, hmacKey); },
  });
  return c.json(200, challenge);
}

module.exports = {
  ALGORITHM: ALGORITHM,
  DEFAULT_MAXNUMBER: DEFAULT_MAXNUMBER,
  DEFAULT_TTL_SECONDS: DEFAULT_TTL_SECONDS,
  CAPTCHA_REQUIRED: CAPTCHA_REQUIRED,
  CAPTCHA_INVALID: CAPTCHA_INVALID,
  CAPTCHA_EXPIRED: CAPTCHA_EXPIRED,
  CAPTCHA_REPLAY: CAPTCHA_REPLAY,
  CAPTCHA_UNCONFIGURED: CAPTCHA_UNCONFIGURED,
  CAPTCHA_UNAVAILABLE: CAPTCHA_UNAVAILABLE,
  createChallenge: createChallenge,
  verifyPayload: verifyPayload,
  base64Decode: base64Decode,
  constantTimeEqual: constantTimeEqual,
  createConsumedSet: createConsumedSet,
  // PB 运行时胶水
  requireCaptcha: requireCaptcha,
  challengeHandler: challengeHandler,
  consumeChallengeUse: consumeChallengeUse,
  isCaptchaError: isCaptchaError,
  captchaFailure: captchaFailure,
  captchaError: captchaError,
};
