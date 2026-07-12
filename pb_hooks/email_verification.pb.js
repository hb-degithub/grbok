(function () {
/// <reference path="../pb_data/types.d.ts" />

// Email verification management: auto-send on registration,
// rate limit resend requests, and log successful verifications.

// ─── Rate limiting state ─────────────────────────────────────
const MAX_VERIFY_PER_IP = 5;
const MAX_VERIFY_PER_EMAIL = 3;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

const verifyRateBuckets = globalThis.verifyRateBuckets || (globalThis.verifyRateBuckets = {});

let verifyLastCleanup = Date.now();

function verifyMaybeCleanup() {
  const now = Date.now();
  if (now - verifyLastCleanup < 5 * 60 * 1000) return;
  verifyLastCleanup = now;
  for (const key of Object.keys(verifyRateBuckets)) {
    const bucket = verifyRateBuckets[key];
    if (!bucket || bucket.length === 0 || now - bucket[bucket.length - 1] > VERIFY_WINDOW_MS) {
      delete verifyRateBuckets[key];
    }
  }
}

function getVerifyHeader(e, name) {
  try { return e.httpContext?.request()?.header?.get(name) || ''; } catch (_) { return ''; }
}

function getVerifyClientIP(e) {
  // Prefer PocketBase's trusted realIP() over spoofable X-Forwarded-For.
  try {
    const real = e.httpContext?.realIP?.();
    if (real && real.trim()) return real.trim();
  } catch (_) {}
  const realIP = getVerifyHeader(e, 'X-Real-IP');
  if (realIP) return realIP.trim();
  const forwarded = getVerifyHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '';
}

function verifyRateLimit(key, maxAttempts) {
  const now = Date.now();
  verifyMaybeCleanup();
  const bucket = verifyRateBuckets[key] || [];
  const active = bucket.filter((t) => now - t < VERIFY_WINDOW_MS);
  if (active.length >= maxAttempts) return false;
  active.push(now);
  verifyRateBuckets[key] = active;
  return true;
}

// ─── Auto-send verification email after registration ─────────
onRecordAfterCreateRequest((e) => {
  const record = e.record;
  if (!record) { if (typeof e.next === 'function') e.next(); return; }

  // Skip if already verified (shouldn't happen on create, but defensive)
  if (record.verified()) { if (typeof e.next === 'function') e.next(); return; }

  try {
    const user = $app.dao().findRecordById('users', record.id);
    $app.dao().requestVerification(user);
    console.log('[email-verify] Verification email sent to:', user.get('email'));
  } catch (err) {
    // Log but don't block registration — verification is progressive
    console.error('[email-verify] Failed to send verification email:', err);
  }

  if (typeof e.next === 'function') e.next();
}, 'users');

// ─── Rate limit verification email resend ────────────────────
onRecordBeforeRequestVerificationRequest((e) => {
  const ip = getVerifyClientIP(e);
  const email = (e.record?.get?.('email') || '').toLowerCase();

  if (ip && !verifyRateLimit('verify:ip:' + ip, MAX_VERIFY_PER_IP)) {
    throw new BadRequestError('验证邮件请求过于频繁，请15分钟后再试');
  }
  if (email && !verifyRateLimit('verify:email:' + email, MAX_VERIFY_PER_EMAIL)) {
    throw new BadRequestError('验证邮件请求过于频繁，请15分钟后再试');
  }

  if (typeof e.next === 'function') e.next();
}, 'users');

// ─── Log successful verification ─────────────────────────────
onRecordAfterConfirmVerificationRequest((e) => {
  const record = e.record;
  if (record) {
    console.log('[email-verify] Email verified for user:', record.id, record.get('email'));
  }
  if (typeof e.next === 'function') e.next();
}, 'users');
})();
