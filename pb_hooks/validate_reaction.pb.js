(function () {
/// <reference path="../pb_data/types.d.ts" />

// Reaction rate limiting — per-IP, in-memory with periodic cleanup
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REACTIONS = 20;
const buckets = globalThis.__reactionBuckets || (globalThis.__reactionBuckets = {});
let lastCleanup = Date.now();

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  for (const key of Object.keys(buckets)) {
    const entry = buckets[key];
    if (entry && now - entry.windowStart > WINDOW_MS) {
      delete buckets[key];
    }
  }
}

onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  if (!record) return;

  let auth = e.auth || null;
  if (!auth) {
    try {
      const requestInfo = $apis.requestInfo(e.httpContext);
      auth = requestInfo.auth || requestInfo.authRecord || null;
    } catch (_) {}
  }
  if (auth) {
    record.set('user_id', auth.id);
  } else if (String(record.get('user_id') || '').trim()) {
    throw new BadRequestError('Anonymous reactions cannot set user_id');
  }

  // Require fingerprint
  const fp = String(record.get('fingerprint') || '').trim();
  if (fp.length < 10) {
    throw new BadRequestError('Fingerprint is required');
  }

  // IP-based rate limiting（统一使用 client_ip.js 获取真实 IP）
  var rateLimit = require(__hooks + '/lib/security_rate_limit.js');
  var ip;
  try {
    ip = rateLimit.normalizeIp(require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext));
  } catch (_) {
    ip = 'unknown';
  }
  const key = 'rxn:' + ip;
  const now = Date.now();

  maybeCleanup();

  let entry = buckets[key];
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    buckets[key] = entry;
  }

  if (entry.count >= MAX_REACTIONS) {
    throw new BadRequestError('Too many reactions, please try again later');
  }

  entry.count++;
}, 'reactions');
})();
