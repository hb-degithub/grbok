(function () {
/// <reference path="../pb_data/types.d.ts" />

// Comment report rate limiting — per-IP, in-memory with periodic cleanup
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REPORTS = 5;
const buckets = globalThis.__reportBuckets || (globalThis.__reportBuckets = {});
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

  // Rate limit by IP
  const info = $apis.requestInfo(e.httpContext);
  const ip = (info.clientIp || 'unknown').trim();
  const key = 'report:' + ip;
  const now = Date.now();

  maybeCleanup();

  let entry = buckets[key];
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    buckets[key] = entry;
  }

  if (entry.count >= MAX_REPORTS) {
    throw new BadRequestError('Too many reports, please try again later');
  }

  entry.count++;
}, 'comment_reports');
})();