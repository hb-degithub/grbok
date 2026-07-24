// 密码登录速率限制（per-IP + per-email）— 全部逻辑在此。
// login_security.pb.js 只做薄注册（PB 0.22 JSVM 的 onAdmin* 回调按源码重 eval，
// 访问不到文件级闭包，故回调内 require 本模块；onRecord* 与 onAdmin* 经
// globalThis 共享同一组限流桶）。
const MAX_ATTEMPTS_PER_IP = 10;      // 同一IP 15分钟内最多10次
const MAX_ATTEMPTS_PER_EMAIL = 5;    // 同一邮箱 15分钟内最多5次
const WINDOW_MS = 15 * 60 * 1000;    // 15分钟窗口

const loginRateBuckets = globalThis.loginRateBuckets || (globalThis.loginRateBuckets = {});
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
}

function getClientIP(e) {
  try {
    const real = e.httpContext?.realIP?.();
    if (real && real.trim()) return real.trim();
  } catch (_) {}
  return '';
}

function getEmailFromBody(e) {
  try {
    const body = e.request?.body;
    if (!body) return '';
    const parsed = JSON.parse(typeof body === 'string' ? body : JSON.stringify(body));
    return (parsed.identity || '').trim().toLowerCase();
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

function checkAndRecord(e) {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);

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
  if (ip) delete loginRateBuckets['login:ip:' + ip];
  if (email) delete loginRateBuckets['login:email:' + email];
  if (typeof e.next === 'function') e.next();
}

module.exports = {
  checkAndRecord,
  clearAttempts,
};
