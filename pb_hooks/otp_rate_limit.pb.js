(function () {
/// <reference path="../pb_data/types.d.ts" />

// OTP（魔法链接）请求速率限制 — per-IP + per-email
// 防止邮件轰炸攻击：限制同一IP/邮箱在窗口期内的验证码请求次数
const MAX_OTP_PER_IP = 5;           // 同一IP 15分钟内最多5次
const MAX_OTP_PER_EMAIL = 3;        // 同一邮箱 15分钟内最多3次
const WINDOW_MS = 15 * 60 * 1000;   // 15分钟窗口

const otpRateBuckets = globalThis.otpRateBuckets || (globalThis.otpRateBuckets = {});

let otpLastCleanup = Date.now();

function otpMaybeCleanup() {
  const now = Date.now();
  if (now - otpLastCleanup < 5 * 60 * 1000) return;
  otpLastCleanup = now;
  for (const key of Object.keys(otpRateBuckets)) {
    const bucket = otpRateBuckets[key];
    if (!bucket || bucket.length === 0 || now - bucket[bucket.length - 1] > WINDOW_MS) {
      delete otpRateBuckets[key];
    }
  }
}

function getHeader(e, name) {
  try {
    return e.httpContext?.request()?.header?.get(name) || '';
  } catch (_) {
    return '';
  }
}

function getClientIP(e) {
  // Prefer PocketBase's trusted realIP() over spoofable X-Forwarded-For.
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
  otpMaybeCleanup();
  const bucket = otpRateBuckets[key] || [];
  const active = bucket.filter((t) => now - t < WINDOW_MS);
  if (active.length >= maxAttempts) return false; // 限速触发
  active.push(now);
  otpRateBuckets[key] = active;
  return true; // 允许通过
}

// OTP请求限速检查：在发送验证码邮件之前执行
// 注意：OTP成功不代表用户已认证（仅表示邮件已发送），因此不清除计数器
if (typeof onRecordBeforeAuthWithOTPRequest === 'function') {
  onRecordBeforeAuthWithOTPRequest((e) => {
  const ip = getClientIP(e);
  const email = getEmailFromBody(e);

  if (ip && !rateLimit('otp:ip:' + ip, MAX_OTP_PER_IP)) {
    throw new BadRequestError('验证码请求过于频繁，请稍后再试');
  }
  if (email && !rateLimit('otp:email:' + email, MAX_OTP_PER_EMAIL)) {
    throw new BadRequestError('验证码请求过于频繁，请稍后再试');
  }

  if (typeof e.next === 'function') e.next();
  }, 'users');
}
})();
