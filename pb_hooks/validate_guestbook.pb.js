/// <reference path="../pb_data/types.d.ts" />

onRecordBeforeCreateRequest(function (e) {
  function stripTags(value) {
    return String(value || '').replace(/<\/?[A-Za-z][^<>]*>/g, '').trim();
  }

  function validNickname(value) {
    return value.length >= 1 && value.length <= 30 && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validContent(value) {
    return value.length >= 1 && value.length <= 500;
  }

  function spam(value) {
    if (/[\u0000-\u001f\u007f]/.test(value)) return true;
    if ((value.match(/https?:\/\//gi) || []).length >= 3) return true;
    return /([\s\S])\1{24,}/.test(value);
  }

  function detailedError(status, code, retryAfter) {
    var data = {
      code: new ValidationError(code, code),
    };
    if (retryAfter) {
      data.retryAfter = new ValidationError('GUESTBOOK_RETRY_AFTER', String(retryAfter));
    }
    return new ApiError(status, code, data);
  }

  var rateLimit = require(__hooks + '/lib/security_rate_limit.js');
  var nickname = stripTags(e.record.get('nickname'));
  var content = stripTags(e.record.get('content'));
  if (!validNickname(nickname) || !validContent(content) || spam(content)) {
    throw detailedError(400, 'GUESTBOOK_INVALID');
  }

  var ip;
  try {
    ip = rateLimit.normalizeIp(require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext));
  } catch (_) {
    throw detailedError(503, 'GUESTBOOK_UNAVAILABLE');
  }

  var decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: 'guestbook_ip', subject: ip }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    throw detailedError(503, 'GUESTBOOK_UNAVAILABLE');
  }

  if (!decision.allowed) {
    throw detailedError(429, 'GUESTBOOK_RATE_LIMITED', decision.retryAfterSeconds);
  }

  e.record.set('nickname', nickname);
  e.record.set('content', content);
  e.record.set('status', 'show');
  if (typeof e.next === 'function') e.next();
}, 'guestbook_messages');
