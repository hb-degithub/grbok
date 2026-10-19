'use strict';

// 密码登录速率限制（per-IP + per-email）— 全部逻辑在此。
// login_security.pb.js 只做薄注册（回调内 require 本模块；onRecord* 与 onAdmin*
// 共用同一组策略桶，与旧实现共用同一组 globalThis 内存桶等价）。
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
//   * ali-real-client-ip 由 ESA 边缘注入，能直连源站（绕过 ESA）或 --resolve 到不同
//     边缘节点的攻击者，仍可用不同 IP 换掉 login_ip 桶。不可伪造的兜底只有
//     login_email_any（单邮箱 30 次/15 分钟）与 admin 链路的 TOTP step-up。
//   * 若 ali-real-client-ip 缺失，client_ip.js 回退 realIP()（反代自身地址），
//     此时所有请求共用同一个 login_ip 桶 —— 由 scripts/check-real-ip-chain.ps1 守护。
//   * 策略存储不可用（策略行缺失 / SQLite 故障）时降级回内存桶并打 error 日志：
//     可用性优先，避免 2026-06 那类"限流把登录整体打成 400"的回归。

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
// 优先 ESA 注入并覆盖的 ali-real-client-ip 头，缺失时才回退 realIP()
// （本地开发/SSH 隧道场景）。取不到 IP 时用统一桶兜底，而非跳过限流。
function getClientIP(e) {
  try {
    const ctx = (e && e.httpContext) ? e.httpContext : e;
    const v = clientIpModule.clientIp(ctx);
    if (v && String(v).trim()) return String(v).trim();
  } catch (_) {}
  return 'unknown';
}

function getEmailFromBody(e) {
  // e.requestInfo() 在 PB 0.22.21 JSVM 认证事件上不存在；
  // 与 stats_lib.js readBody 同款：readerToString + JSON.parse，失败回退 ''，
  // 保持限流语义不变（取不到 email 时仅按 IP 限流）。
  try {
    const ctx = (e && e.httpContext) ? e.httpContext : e;
    const raw = readerToString(ctx.request().body, 4097);
    const body = raw ? JSON.parse(raw) : {};
    return String(body.identity || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
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
  const email = getEmailFromBody(e);
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

// 登录成功后清零（旧实现在成功回调里 delete 内存桶）。
function clearAttempts(e) {
  const ip = normalizeSubjectIp(getClientIP(e));
  const email = getEmailFromBody(e);
  const entries = buildEntries(ip, email);
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
