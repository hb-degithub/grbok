'use strict';

// 密码登录速率限制（per-IP + per-email）— 全部逻辑在此。
// login_security.pb.js 只做薄注册（回调内 require 本模块；onRecord* 与 onAdmin*
// 共用同一组策略桶，与旧实现共用同一组 globalThis 内存桶等价）。
//
// 2026-11-08 渗透测试修复（Task 3）：
//   1. 登录身份改从认证事件的 `e.identity` 读取（PB 0.22 实测：JSON 与
//      application/x-www-form-urlencoded 登录事件都会带上已解析的 identity），
//      必要时回退 `$apis.requestInfo(ctx).body.identity`；**不再读 request().body**。
//      旧实现用 readerToString(request().body, 4097) + JSON.parse：
//        - form 登录取不到 identity，两个 email 桶完全不计数；
//        - 超长 JSON body 被截断到 4097 字节后解析失败，email 桶同样失守；
//        - 还抢在 PB 绑定 body 之前把 body 读掉，实测 0.22.48 下会让密码登录
//          直接 400（"An error occurred while loading the submitted data."）。
//   2. 缺失 identity 时也必须进入一个共享 email 桶（不再只剩 IP 维度）。
//   3. 登录成功后只清 login_email_ip 与 login_email_any；**绝不清共享 login_ip 桶**，
//      避免任何一个账号的成功登录把整个 IP 的失败预算清零。
//   4. 客户端 IP 由 client_ip.js 按 PB_TRUSTED_PROXY_IPS 可信 peer 判定，
//      伪造 ali-real-client-ip 不再能换桶。
//
// 2026-10-14 渗透测试 #5 修复（根因 file:line 见 docs/security-pentest-2026-10-14-triage.md）：
//   旧实现 pb_hooks/lib/client_ip.js:10 + 本文件 :116-125 把限流桶键建立在前端可影响的
//   ali-real-client-ip 上，且状态只存 globalThis 内存 → ① 进程重启计数清零；
//   ② 多实例不共享；③ 攻击者轮换边缘 IP 即可线性放大口令枚举预算。
//   现下沉到 security_rate_buckets（security_rate_limit.consume / resetBuckets）：
//     login_ip         10 次 / 15 分钟（客户端 IP；IPv6 归一为 /64）
//     login_email_ip    5 次 / 15 分钟（email|ip 组合 — 保持旧实现数值与 DoS 取向）
//     login_email_any  30 次 / 15 分钟（email 跨 IP 聚合 — 唯一不可被边缘 IP 轮换绕过的维度）
//   三个策略键必须同时存在于 security_policy_store.js 的 DEFAULTS+BOUNDS 与配套迁移
//   20261014200000_add_login_otp_rate_policies.pb.js，缺一即整组策略 fail-closed 降级。
//
// 保留的语义（不得回归）：
//   * per-IP 10 次/15 分钟、per-email 5 次/15 分钟；文案固定为「登录尝试过于频繁，请15分钟后再试」。
//   * 失败尝试在"校验口令之前"计数（旧实现在 e.next() 之前 push 时间戳）；
//     登录成功后清零（旧实现 clearAttempts 删除内存桶 → 现 resetBuckets 删除持久桶）。
//   * users（onRecord*）与 admins（onAdmin*）两条链路共用同一组策略键。
//
// 必须写进文档的残余事实：
//   * 边缘链路（ESA → 雷池 → Caddy）必须在 PB_TRUSTED_PROXY_IPS 内，Caddy 才会
//     被 PB 视为可信 peer；否则 ali-real-client-ip 被忽略（安全但粗粒度：所有
//     客户端共用 Caddy 容器 IP 一个 login_ip 桶）。该配置由
//     scripts/check-real-ip-chain.ps1 与本任务的 login 套件守护。
//   * 即使可信 peer 配置正确，能轮换真实边缘出口 IP 的攻击者仍可摊薄 login_ip；
//     不可伪造的兜底是 login_email_any（单邮箱 30 次/15 分钟）与 admin 链路的 TOTP step-up。
//   * 策略存储不可用（策略行缺失 / SQLite 故障 / MAIL_HASH_SECRET 缺失）时降级回
//     内存桶并打 error 日志：可用性优先，避免 2026-06 那类"限流把登录整体打成 400"的回归。

const MAX_ATTEMPTS_PER_IP = 10; // 同一 IP 15 分钟内最多 10 次
const MAX_ATTEMPTS_PER_EMAIL_IP = 5; // 同一 email+IP 15 分钟内最多 5 次
const MAX_ATTEMPTS_PER_EMAIL_ANY_IP = 30; // 同一 email 跨 IP 汇总 15 分钟内最多 30 次
const WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口（须与策略表 windowSeconds 一致）
const RATE_LIMIT_MESSAGE = '登录尝试过于频繁，请15分钟后再试';
const STORAGE_LOG_INTERVAL_MS = 60 * 1000;

const POLICY_LOGIN_IP = 'login_ip';
const POLICY_LOGIN_EMAIL_IP = 'login_email_ip';
const POLICY_LOGIN_EMAIL_ANY = 'login_email_any';

const MEMORY_LIMITS = {};
MEMORY_LIMITS[POLICY_LOGIN_IP] = MAX_ATTEMPTS_PER_IP;
MEMORY_LIMITS[POLICY_LOGIN_EMAIL_IP] = MAX_ATTEMPTS_PER_EMAIL_IP;
MEMORY_LIMITS[POLICY_LOGIN_EMAIL_ANY] = MAX_ATTEMPTS_PER_EMAIL_ANY_IP;

const rateLimit = require('./security_rate_limit.js');
const clientIpModule = require('./client_ip.js');

// 降级内存桶：仅当持久化策略表不可用时启用（键为 policyKey + ':' + subject）。
const memoryBuckets = globalThis.loginRateBuckets || (globalThis.loginRateBuckets = {});
const cleanupRef = globalThis.loginLastCleanupRef || (globalThis.loginLastCleanupRef = { t: Date.now() });
const storageLogRef = globalThis.loginSecurityStorageLogRef || (globalThis.loginSecurityStorageLogRef = { t: 0 });

function loginMaybeCleanup() {
  const now = Date.now();
  if (now - cleanupRef.t < 5 * 60 * 1000) return;
  cleanupRef.t = now;
  for (const key of Object.keys(memoryBuckets)) {
    const bucket = memoryBuckets[key];
    if (!bucket || bucket.length === 0 || now - bucket[bucket.length - 1] > WINDOW_MS) {
      delete memoryBuckets[key];
    }
  }
}

function logStorageUnavailable(error) {
  const now = Date.now();
  if (now - storageLogRef.t < STORAGE_LOG_INTERVAL_MS) return;
  storageLogRef.t = now;
  console.error('[login-security] operation=rate-store result=UNAVAILABLE name='
    + String((error && error.name) || 'Error'));
}

// 2026-09-18 安全修复：realIP() 派生自 X-Forwarded-For，可被客户端伪造
// （实测可绕过 Caddy 管理面白名单与 per-IP 限流）。统一改走 client_ip.js：
// 仅当 TCP peer 在 PB_TRUSTED_PROXY_IPS 内时才采信边缘写入的 ali-real-client-ip，
// 否则使用不可伪造的 socket 对端地址。取不到 IP 时用统一桶兜底，而非跳过限流。
function getClientIP(e) {
  try {
    const ctx = (e && e.httpContext) ? e.httpContext : e;
    const v = clientIpModule.clientIp(ctx);
    if (v && String(v).trim()) return String(v).trim();
  } catch (_) {}
  return 'unknown';
}

// 登录身份（邮箱）归一化：仅用于限流桶 subject，绝不用于鉴权判断。
// 认证事件在 PB 0.22 已提供解析后的 identity；requestInfo 仅作回退，且不会重读 body。
function getIdentity(e) {
  let value = '';
  try {
    if (e && e.identity !== undefined && e.identity !== null) value = String(e.identity);
  } catch (_) {
    value = '';
  }
  if (!value) {
    try {
      const ctx = (e && e.httpContext) ? e.httpContext : e;
      if (ctx && typeof $apis !== 'undefined' && $apis && typeof $apis.requestInfo === 'function') {
        const info = $apis.requestInfo(ctx);
        const body = info && info.body;
        if (body && body.identity !== undefined && body.identity !== null) value = String(body.identity);
      }
    } catch (_) {
      value = '';
    }
  }
  return value.trim().toLowerCase();
}

// identity 缺失时收敛到一个共享桶（而不是只剩 IP 维度）。
const UNKNOWN_IDENTITY_SUBJECT = 'unknown-identity';

function getEmailSubject(e) {
  const identity = getIdentity(e);
  return identity || UNKNOWN_IDENTITY_SUBJECT;
}


// 策略桶 subject 归一：非法值收敛到同一个共享桶（等价旧实现的 'unknown'），
// 避免攻击者用任意字符串制造无界桶；IPv6 按 /64 聚合（单主机可自由轮换 2^64 个地址）。
function normalizeSubjectIp(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let normalized;
  try {
    normalized = rateLimit.normalizeIp(value);
  } catch (_) {
    return 'invalid-ip';
  }
  if (normalized.indexOf(':') !== -1) {
    try {
      return rateLimit.ipv6Prefix64(normalized);
    } catch (_) {
      return normalized;
    }
  }
  return normalized;
}

function policyKey(entry) {
  return String(entry && entry.policyKey || '');
}

function memoryKey(entry) {
  return policyKey(entry) + ':' + String(entry && entry.subject || '');
}

function buildEntries(ip, email) {
  const entries = [];
  if (ip) entries.push({ policyKey: POLICY_LOGIN_IP, subject: ip });
  if (email && ip) entries.push({ policyKey: POLICY_LOGIN_EMAIL_IP, subject: email + '|' + ip });
  if (email) entries.push({ policyKey: POLICY_LOGIN_EMAIL_ANY, subject: email });
  return entries;
}

// 降级路径：内存滑窗限速（与 2026-10-14 之前的实现同款语义）。
function memoryConsume(entries) {
  const now = Date.now();
  loginMaybeCleanup();
  for (let i = 0; i < entries.length; i++) {
    const bucket = memoryBuckets[memoryKey(entries[i])] || [];
    let active = 0;
    for (let j = 0; j < bucket.length; j++) {
      if (now - bucket[j] < WINDOW_MS) active++;
    }
    if (active >= MEMORY_LIMITS[policyKey(entries[i])]) return false;
  }
  for (let k = 0; k < entries.length; k++) {
    const key = memoryKey(entries[k]);
    const bucket = memoryBuckets[key] || [];
    bucket.push(now);
    memoryBuckets[key] = bucket;
  }
  return true;
}

function checkAndRecord(e) {
  const ip = normalizeSubjectIp(getClientIP(e));
  const email = getEmailSubject(e);
  const entries = buildEntries(ip, email);
  if (!entries.length) {
    if (typeof e.next === 'function') e.next();
    return;
  }

  let limited = false;
  let storageFailed = false;
  try {
    $app.dao().runInTransaction(function (txDao) {
      const result = rateLimit.consume(txDao, { nowMs: Date.now(), entries: entries });
      if (!result.allowed) limited = true;
    });
  } catch (error) {
    storageFailed = true;
    logStorageUnavailable(error);
  }

  if (!limited && storageFailed && !memoryConsume(entries)) limited = true;
  if (limited) throw new BadRequestError(RATE_LIMIT_MESSAGE);

  if (typeof e.next === 'function') e.next();
}

// 登录成功后清零：只清该 (email, ip) 的 email 桶与 email 跨 IP 桶。
// 共享 login_ip 桶保留 —— 否则任何账号的一次成功登录都会把整个 IP 的
// 失败预算清零，攻击者只要掌握任意一个可用账号即可持续放大口令枚举。
// 旧实现 buildEntries() 三桶全清，属于权限范围过大的副作用。
function clearAttempts(e) {
  const ip = normalizeSubjectIp(getClientIP(e));
  const email = getEmailSubject(e);
  const entries = [];
  if (email && ip) entries.push({ policyKey: POLICY_LOGIN_EMAIL_IP, subject: email + '|' + ip });
  if (email) entries.push({ policyKey: POLICY_LOGIN_EMAIL_ANY, subject: email });
  for (let i = 0; i < entries.length; i++) {
    delete memoryBuckets[memoryKey(entries[i])];
  }
  if (entries.length) {
    try {
      $app.dao().runInTransaction(function (txDao) {
        rateLimit.resetBuckets(txDao, { entries: entries });
      });
    } catch (error) {
      logStorageUnavailable(error);
    }
  }
  if (typeof e.next === 'function') e.next();
}

module.exports = {
  checkAndRecord,
  clearAttempts,
  // 仅测试/诊断用：策略键常量
  POLICY_LOGIN_IP,
  POLICY_LOGIN_EMAIL_IP,
  POLICY_LOGIN_EMAIL_ANY,
};
