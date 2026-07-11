/// <reference path="../pb_data/types.d.ts" />

// 密码登录速率限制 — per-IP + per-email
const MAX_ATTEMPTS_PER_IP = 10;      // 同一IP 15分钟内最多10次
const MAX_ATTEMPTS_PER_EMAIL = 5;    // 同一邮箱 15分钟内最多5次
const WINDOW_MS = 15 * 60 * 1000;    // 15分钟窗口

const loginRateBuckets = globalThis.loginRateBuckets || (globalThis.loginRateBuckets = {});

function getHeader(e, name) {
  try {
    return e.httpContext?.request()?.header?.get(name) || '';
  } catch (_) {
    return '';
  }
}

function getClientIP(e) {
  // Prefer PocketBase's trusted realIP() — Caddy overwrites X-Forwarded-For
  // with the true remote host, but if PB is ever exposed directly (or another
  // untrusted proxy is layered in front), header-based IP would be spoofable.
  // realIP() reflects the configured trusted proxy chain.
  try {
    const real = e.httpContext?.realIP?.();
    if (real && real.trim()) return real.trim();
  } catch (_) {}
  const realIP = getHeader(e, 'X-Real-IP');
  if (realIP) return realIP.trim();
  const forwarded = getHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
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

// 用户密码登录
onRecordBeforeAuthWithPasswordRequest((e) => {
  checkAndRecord(e);
}, 'users');

onRecordAfterAuthWithPasswordRequest((e) => {
  clearAttempts(e);
}, 'users');

// 管理员密码登录
onAdminBeforeAuthWithPasswordRequest((e) => {
  checkAndRecord(e);
});

onAdminAfterAuthWithPasswordRequest((e) => {
  clearAttempts(e);
});
