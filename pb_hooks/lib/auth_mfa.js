'use strict';
var rateLimit = require('./security_rate_limit.js');
function coded(code) { var error = new Error(code); error.code = code; return error; }
function read(e) {
  try { var body = JSON.parse(readerToString(e.request().body, 8192) || '{}'); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch (_) { throw coded('INVALID_REQUEST'); }
}
function validToken(value) { return typeof value === 'string' && /^[A-Za-z0-9._-]{8,512}$/.test(value); }
function loopback(path, body) {
  var base = String($os.getenv('BLOG_AUTH_LOOPBACK_BASE') || 'http://127.0.0.1:8090').replace(/\/$/, '');
  try { return $http.send({ url: base + path, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 8 }); }
  catch (_) { throw coded('MFA_UNAVAILABLE'); }
}
function request(e) {
  var body = read(e); var email;
  try { email = rateLimit.normalizeEmail(String(body.email || '')); } catch (_) { throw coded('INVALID_REQUEST'); }
  if (!validToken(body.mfaId)) throw coded('INVALID_REQUEST');
  var ip;
  try { ip = rateLimit.normalizeIp(String(e.realIP() || '')); } catch (_) { throw coded('MFA_UNAVAILABLE'); }
  var allowed;
  $app.dao().runInTransaction(function (txDao) { allowed = rateLimit.consume(txDao, { nowMs: Date.now(), entries: [
    { policyKey: 'account_mail_email', subject: email }, { policyKey: 'account_mail_ip', subject: ip }, { policyKey: 'account_mail_global', subject: 'v1' },
  ] }); });
  if (!allowed.allowed) { var limited = coded('REQUEST_RATE_LIMITED'); limited.retryAfter = allowed.retryAfterSeconds; throw limited; }
  var response = loopback('/api/collections/users/request-otp', { email: email });
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.json || typeof response.json.otpId !== 'string') throw coded('MFA_UNAVAILABLE');
  return { otpId: response.json.otpId };
}
function verify(e) {
  var body = read(e);
  if (!validToken(body.otpId) || !validToken(body.mfaId) || typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code.trim())) throw coded('INVALID_REQUEST');
  var response = loopback('/api/collections/users/auth-with-otp', { otpId: body.otpId, password: body.code.trim(), mfaId: body.mfaId });
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.json || typeof response.json.token !== 'string' || !response.json.record) throw coded('INVALID_OR_EXPIRED_CODE');
  return response.json;
}
module.exports = { request: request, verify: verify };
