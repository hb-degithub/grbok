// 密码登录速率限制（per-IP + per-email）— 全部逻辑在此。
// login_security.pb.js 只做薄注册（PB 0.22 JSVM 的 onAdmin* 回调按源码重 eval，
// 访问不到文件级闭包，故回调内 require 本模块；onRecord* 与 onAdmin* 经
// globalThis 共享同一组限流桶）。
const MAX_ATTEMPTS_PER_IP = 10;      // 同一IP 15分钟内最多10次
const MAX_ATTEMPTS_PER_EMAIL = 5;    // 同一邮箱 15分钟内最多5次
const WINDOW_MS = 15 * 60 * 1000;    // 15分钟窗口
const LOCKOUT_THRESHOLD = 5;         // 连续失败5次锁定
const LOCKOUT_MS = 15 * 60 * 1000;   // 锁定15分钟

const loginRateBuckets = globalThis.loginRateBuckets || (globalThis.loginRateBuckets = {});
const loginFailCounts = globalThis.loginFailCounts || (globalThis.loginFailCounts = {});
const loginLockouts = globalThis.loginLockouts || (globalThis.loginLockouts = {});
const cleanupRef = globalThis.loginLastCleanupRef || (globalThis.loginLastCleanupRef = { t: Date.now() });

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

function getClientIP(e) {
  try {
    const real = e.httpContext?.realIP?.();
    if (real && real.trim()) return real.trim();
    // 回退到远端地址
    const addr = e.httpContext?.request?.remoteAddr;
    if (addr) return addr.split(':')[0];
  } catch (_) {}
  return 'unknown'; // 用统一桶兜底，而非跳过
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

  // 检查是否被锁定
  if (ip && isLockedOut('login:lock:ip:' + ip)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }
  if (email && isLockedOut('login:lock:email:' + email)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }

  if (ip && !rateLimit('login:ip:' + ip, MAX_ATTEMPTS_PER_IP)) {
    throw new BadRequestError('登录尝试过于频繁，请15分钟后再试');
  }
  if (email && !rateLimit('login:email:' + email, MAX_ATTEMPTS_PER_EMAIL)) {
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
    delete loginRateBuckets['login:email:' + email];
    clearFailure('login:lock:email:' + email);
  }
  if (typeof e.next === 'function') e.next();
}

// 登录失败时调用（在 onRecordAfterAuthWithPasswordRequest 中检测失败）
function recordLoginFailure(e) {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);
  if (ip) recordFailure('login:lock:ip:' + ip);
  if (email) recordFailure('login:lock:email:' + email);
}

module.exports = {
  checkAndRecord,
  clearAttempts,
  recordLoginFailure,
};
