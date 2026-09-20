// 密码登录速率限制（per-IP + per-email）— 全部逻辑在此。
// login_security.pb.js 只做薄注册（回调内 require 本模块；onRecord* 与 onAdmin* 经
// globalThis 共享同一组限流桶）。
// 限流状态为单实例内存实现：PB 进程重启后计数清零，多实例部署不共享状态。
// 如需持久化/跨实例共享，应接入 pb_hooks/lib/security_rate_limit.js 的
// consume(policyKey, subject) API（基于 security_rate_buckets 集合）。
const MAX_ATTEMPTS_PER_IP = 10;      // 同一IP 15分钟内最多10次
const MAX_ATTEMPTS_PER_EMAIL = 5;    // 同一邮箱 15分钟内最多5次
const MAX_ATTEMPTS_PER_EMAIL_ANY_IP = 30; // 同一邮箱跨IP汇总 15分钟内最多30次（2026-09-20）
const WINDOW_MS = 15 * 60 * 1000;    // 15分钟窗口
const LOCKOUT_THRESHOLD = 5;         // 连续失败5次锁定
const LOCKOUT_MS = 15 * 60 * 1000;   // 锁定15分钟

// 内存限流桶（globalThis 供各 hook 文件共享）
const loginRateBuckets = globalThis.loginRateBuckets || (globalThis.loginRateBuckets = {});
const loginFailCounts = globalThis.loginFailCounts || (globalThis.loginFailCounts = {});
const loginLockouts = globalThis.loginLockouts || (globalThis.loginLockouts = {});
const cleanupRef = globalThis.loginLastCleanupRef || (globalThis.loginLastCleanupRef = { t: Date.now() });
const clientIpModule = require('./client_ip.js');

function loginMaybeCleanup() {
  const now = Date.now();
  if (now - cleanupRef.t < 5 * 60 * 1000) return;
  cleanupRef.t = now;
  for (const key of Object.keys(loginRateBuckets)) {
    const bucket = loginRateBuckets[key];
    if (!bucket || bucket.length === 0 || now - bucket[bucket.length - 1] > WINDOW_MS) {
      delete loginRateBuckets[key];
    }
  }
  // 清理过期的锁定
  for (const key of Object.keys(loginLockouts)) {
    if (now > loginLockouts[key]) {
      delete loginLockouts[key];
      delete loginFailCounts[key];
    }
  }
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

function rateLimit(key, maxAttempts) {
  const now = Date.now();
  loginMaybeCleanup();
  const bucket = loginRateBuckets[key] || [];
  const active = bucket.filter((t) => now - t < WINDOW_MS);
  if (active.length >= maxAttempts) return false; // 限速触发
  active.push(now);
  loginRateBuckets[key] = active;
  return true; // 允许通过
}

function isLockedOut(key) {
  const lockUntil = loginLockouts[key];
  return lockUntil && Date.now() < lockUntil;
}

function recordFailure(key) {
  const now = Date.now();
  loginFailCounts[key] = (loginFailCounts[key] || 0) + 1;
  if (loginFailCounts[key] >= LOCKOUT_THRESHOLD) {
    loginLockouts[key] = now + LOCKOUT_MS;
    delete loginFailCounts[key];
    return true; // 已锁定
  }
  return false;
}

function clearFailure(key) {
  delete loginFailCounts[key];
  delete loginLockouts[key];
}

function checkAndRecord(e) {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);
  // 邮箱维度一律与 IP 组合键控：纯 per-email 锁定/限速会让任何人用受害者邮箱
  // 故意失败 5 次即可把受害者锁在门外（账号锁定 DoS，2026-09-18 审计发现）。
  // IP 现在经 client_ip.js 取真实值，组合键仍可限住单点爆破；
  // 分布式爆破由 per-IP 轴兜底，admin 账号另有 TOTP step-up 兜底。
  const emailIp = email ? email + '|' + ip : '';

  // 检查是否被锁定
  if (ip && isLockedOut('login:lock:ip:' + ip)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }
  if (emailIp && isLockedOut('login:lock:emailip:' + emailIp)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }

  if (ip && !rateLimit('login:ip:' + ip, MAX_ATTEMPTS_PER_IP)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }
  if (emailIp && !rateLimit('login:emailip:' + emailIp, MAX_ATTEMPTS_PER_EMAIL)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }
  // 2026-09-20 审计：直连源站路径可伪造 ali-real-client-ip 轮换 IP 绕过 per-IP 限流
  // （密码喷洒面）。增加跨 IP 按邮箱聚合的兜底窗口：滑窗限速（非锁定态），正常用户
  // 等窗口滑动即可重试；攻击者对单邮箱每 15 分钟至多 30 次尝试。
  if (email && !rateLimit('login:emailany:' + email, MAX_ATTEMPTS_PER_EMAIL_ANY_IP)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }

  if (typeof e.next === 'function') e.next();
}

function clearAttempts(e) {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);
  if (ip) {
    delete loginRateBuckets['login:ip:' + ip];
    clearFailure('login:lock:ip:' + ip);
  }
  if (email) {
    delete loginRateBuckets['login:emailip:' + email + '|' + ip];
    clearFailure('login:lock:emailip:' + email + '|' + ip);
    delete loginRateBuckets['login:emailany:' + email];
  }
  if (typeof e.next === 'function') e.next();
}

// 登录失败时调用（在 onRecordAfterAuthWithPasswordRequest 中检测失败）
function recordLoginFailure(e) {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);
  if (ip) recordFailure('login:lock:ip:' + ip);
  if (email) recordFailure('login:lock:emailip:' + email + '|' + ip);
}

module.exports = {
  checkAndRecord,
  clearAttempts,
  recordLoginFailure,
};
