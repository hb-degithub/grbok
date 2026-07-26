(function () {
/// <reference path="../pb_data/types.d.ts" />

// Comment report rate limiting — per-IP, persisted via security_rate_limit so
// limits survive restarts and stay consistent across instances.
onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  if (!record) return;

  const rateLimit = require(__hooks + '/lib/security_rate_limit.js');

  // Detailed error shape mirroring validate_guestbook.pb.js so the frontend
  // can surface a server-provided message.
  const detailedError = (status, code, retryAfter) => {
    const data = {
      code: new ValidationError(code, code),
    };
    if (retryAfter) {
      data.retryAfter = new ValidationError('COMMENT_REPORT_RETRY_AFTER', String(retryAfter));
    }
    return new ApiError(status, code, data);
  };

  // Resolve real client IP through the shared client_ip helper (ESA
  // ali-real-client-ip header with realIP() fallback). Preserve the original
  // 'unknown' fallback subject when no IP can be resolved so reporters
  // behind a misconfigured proxy still share a single bucket instead of being
  // blocked outright.
  let ip;
  try {
    const raw = require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext);
    ip = rateLimit.normalizeIp(raw);
  } catch (_) {
    ip = 'unknown';
  }

  let decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: 'comment_report_ip', subject: ip }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    // RateLimitUnavailableError — fail closed with 503.
    throw detailedError(503, 'COMMENT_REPORT_UNAVAILABLE');
  }

  if (!decision.allowed) {
    throw detailedError(429, 'COMMENT_REPORT_RATE_LIMITED', decision.retryAfterSeconds);
  }

  if (typeof e.next === 'function') e.next();
}, 'comment_reports');
})();
