'use strict';

var MAX_SKEW_MS = 5 * 60 * 1000;
var testDependencies = null;

function archiveError(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function dependencies() {
  if (testDependencies) return testDependencies;
  var secret = String($os.getenv('MAIL_ARCHIVE_HMAC_SECRET') || '');
  if (secret.length < 32) throw archiveError('ARCHIVE_AUTH_NOT_CONFIGURED');
  return {
    security: $security,
    secret: secret,
    runInTransaction: function (callback) { return $app.runInTransaction(callback); },
  };
}

function newRecord(dao, collection) {
  if (typeof dao.newRecord === 'function') return dao.newRecord(collection);
  return new Record(collection);
}

function timestampMs(value) {
  var parsed = Number(value);
  if (!isFinite(parsed)) throw archiveError('ARCHIVE_TIMESTAMP_INVALID');
  return parsed < 100000000000 ? parsed * 1000 : parsed;
}

function consumeNonce(dao, nonce, requestMs, nowMs) {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(String(nonce || ''))) throw archiveError('ARCHIVE_NONCE_INVALID');
  var existing = dao.findRecordsByFilter('mail_archive_request_nonces', 'nonce = {:nonce}', '', 1, 0, { nonce: nonce }) || [];
  if (existing.length) throw archiveError('ARCHIVE_NONCE_REPLAY');
  var row = newRecord(dao, dao.findCollectionByNameOrId('mail_archive_request_nonces'));
  row.set('nonce', nonce);
  row.set('request_timestamp', new Date(requestMs).toISOString());
  row.set('expires_at', new Date(nowMs + MAX_SKEW_MS).toISOString());
  try { dao.saveRecord(row); } catch (_) { throw archiveError('ARCHIVE_NONCE_REPLAY'); }
}

function authenticateSignedJson(dao, request, nowMs) {
  var deps = dependencies();
  var rawBody = String(request.rawBody || '');
  var actualBodyHash = deps.security.sha256(rawBody);
  if (!deps.security.equal(actualBodyHash, String(request.bodySha256 || ''))) {
    throw archiveError('ARCHIVE_BODY_HASH_MISMATCH');
  }
  var requestMs = timestampMs(request.timestamp);
  if (Math.abs(Number(nowMs) - requestMs) > MAX_SKEW_MS) throw archiveError('ARCHIVE_TIMESTAMP_SKEW');
  var canonical = [String(request.timestamp), String(request.nonce), String(request.method).toUpperCase(), String(request.path), actualBodyHash].join('\n');
  var expected = deps.security.hs256(canonical, deps.secret);
  if (!deps.security.equal(expected, String(request.signature || ''))) throw archiveError('ARCHIVE_SIGNATURE_INVALID');
  deps.runInTransaction(function (txDao) { consumeNonce(txDao, String(request.nonce), requestMs, Number(nowMs)); });
  try { return JSON.parse(rawBody || '{}'); } catch (_) { throw archiveError('ARCHIVE_BODY_INVALID'); }
}

function cleanupExpiredNonces(dao, nowMs, limit) {
  var bounded = Math.max(1, Math.min(Math.floor(Number(limit) || 100), 500));
  var rows = dao.findRecordsByFilter('mail_archive_request_nonces', 'expires_at < {:now}', 'expires_at', bounded, 0, { now: new Date(nowMs).toISOString() }) || [];
  for (var i = 0; i < rows.length; i++) dao.deleteRecord(rows[i]);
  return rows.length;
}

// 归档路由公共处理：开关检查 + 签名验证 + 统一错误映射。
// operation 为 handler 内闭包（参数为已验证的 JSON body），返回要写给客户端的对象。
function handleSignedRoute(e, routePath, operation) {
  function header(name) { try { return String(e.request().header.get(name) || ''); } catch (_) { return ''; } }
  if (String($os.getenv('MAIL_ARCHIVE_API_ENABLED') || 'false').toLowerCase() !== 'true') {
    return e.json(409, { code: 'ARCHIVE_API_DISABLED' });
  }
  try {
    var raw = readerToString(e.request().body, 65537);
    var body = authenticateSignedJson($app.dao(), {
      timestamp: header('X-Archive-Timestamp'), nonce: header('X-Archive-Nonce'),
      signature: header('X-Archive-Signature'), bodySha256: header('X-Archive-Body-SHA256'),
      method: 'POST', path: routePath, rawBody: raw,
    }, Date.now());
    return e.json(200, operation(body));
  } catch (error) {
    var code = String(error && error.code || 'ARCHIVE_REQUEST_REJECTED');
    var authFailure = code.indexOf('SIGNATURE') !== -1 || code.indexOf('NONCE') !== -1 || code.indexOf('TIMESTAMP') !== -1 || code.indexOf('BODY_HASH') !== -1;
    var status = authFailure ? 401 : 409;
    if (authFailure) code = 'ARCHIVE_AUTH_REJECTED';
    return e.json(status, { code: code });
  }
}

function setDependenciesForTests(value) { testDependencies = value; }
function resetDependenciesForTests() { testDependencies = null; }

module.exports = {
  authenticateSignedJson: authenticateSignedJson,
  cleanupExpiredNonces: cleanupExpiredNonces,
  handleSignedRoute: handleSignedRoute,
  _setDependenciesForTests: setDependenciesForTests,
  _resetDependenciesForTests: resetDependenciesForTests,
};
