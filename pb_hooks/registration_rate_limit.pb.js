/// <reference path="../pb_data/types.d.ts" />

// 用户注册速率限制 — per-IP
const MAX_REGISTRATIONS_PER_IP = 3;    // 同一IP 60分钟内最多3次注册
const WINDOW_MS = 60 * 60 * 1000;      // 60分钟窗口

const registrationRateBuckets = globalThis.registrationRateBuckets || (globalThis.registrationRateBuckets = {});

function getHeader(e, name) {
  try {
    return e.httpContext?.request()?.header?.get(name) || '';
  } catch (_) {
    return '';
  }
}

function getClientIP(e) {
  const realIP = getHeader(e, 'X-Real-IP');
  if (realIP) return realIP.trim();
  const forwarded = getHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  try {
    return e.httpContext?.realIP?.() || '';
  } catch (_) {
    return '';
  }
}

function rateLimit(key, maxAttempts) {
  const now = Date.now();
  const bucket = registrationRateBuckets[key] || [];
  const active = bucket.filter((t) => now - t < WINDOW_MS);
  if (active.length >= maxAttempts) return false; // 限速触发
  active.push(now);
  registrationRateBuckets[key] = active;
  return true; // 允许通过
}

// 清理过期桶，防止内存泄漏
function cleanupExpiredBuckets() {
  const now = Date.now();
  for (const key of Object.keys(registrationRateBuckets)) {
    const bucket = registrationRateBuckets[key];
    const active = bucket.filter((t) => now - t < WINDOW_MS);
    if (active.length === 0) {
      delete registrationRateBuckets[key];
    } else {
      registrationRateBuckets[key] = active;
    }
  }
}

// 每次请求时顺便清理（低频，不会影响性能）
let lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup > WINDOW_MS) {
    cleanupExpiredBuckets();
    lastCleanup = now;
  }
}

onRecordBeforeCreateRequest((e) => {
  if (e.collection.name !== 'users') {
    if (typeof e.next === 'function') e.next();
    return;
  }

  maybeCleanup();

  const ip = getClientIP(e);
  if (ip && !rateLimit('register:ip:' + ip, MAX_REGISTRATIONS_PER_IP)) {
    throw new BadRequestError('注册请求过于频繁，请稍后再试');
  }

  if (typeof e.next === 'function') e.next();
}, 'users');
