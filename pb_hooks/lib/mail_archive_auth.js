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

function setDependenciesForTests(value) { testDependencies = value; }
function resetDependenciesForTests() { testDependencies = null; }

module.exports = {
  authenticateSignedJson: authenticateSignedJson,
  cleanupExpiredNonces: cleanupExpiredNonces,
  _setDependenciesForTests: setDependenciesForTests,
  _resetDependenciesForTests: resetDependenciesForTests,
};
