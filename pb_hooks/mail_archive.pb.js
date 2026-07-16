(function () {
'use strict';

var archive = require(__hooks + '/lib/mail_archive.js');
var auth = require(__hooks + '/lib/mail_archive_auth.js');
var PREFIX = '/api/blog-internal/mail-archive/';

function enabled() { return String($os.getenv('MAIL_ARCHIVE_API_ENABLED') || 'false').toLowerCase() === 'true'; }
function header(e, name) { try { return String(e.request().header.get(name) || ''); } catch (_) { return ''; } }
function signedBody(e, routePath) {
  if (!enabled()) throw Object.assign(new Error('ARCHIVE_API_DISABLED'), { code: 'ARCHIVE_API_DISABLED' });
  var raw = readerToString(e.request().body, 65537);
  return auth.authenticateSignedJson($app.dao(), {
    timestamp: header(e, 'X-Archive-Timestamp'), nonce: header(e, 'X-Archive-Nonce'),
    signature: header(e, 'X-Archive-Signature'), bodySha256: header(e, 'X-Archive-Body-SHA256'),
    method: 'POST', path: routePath, rawBody: raw,
  }, Date.now());
}
function route(name, operation) {
  var routePath = PREFIX + name;
  routerAdd('POST', routePath, function (e) {
    try { return e.json(200, operation(signedBody(e, routePath))); }
    catch (error) {
      var code = String(error && error.code || 'ARCHIVE_REQUEST_REJECTED');
      var authFailure = code.indexOf('SIGNATURE') !== -1 || code.indexOf('NONCE') !== -1 || code.indexOf('TIMESTAMP') !== -1 || code.indexOf('BODY_HASH') !== -1;
      var status = authFailure ? 401 : 409;
      if (authFailure) code = 'ARCHIVE_AUTH_REJECTED';
      return e.json(status, { code: code });
    }
  }, $apis.bodyLimit(65536));
}

route('status', function (body) { return body.batch_id ? archive.getBatchStatus(body.batch_id) : (archive.getPendingBatch() || { empty: true }); });
route('prepare', function (body) { return archive.prepareBatch(Date.now(), body.limit || 5000) || { empty: true }; });
route('export', function (body) { return archive.exportBatch(body.batch_id); });
route('seal', function (body) { return archive.sealBatch(body.batch_id, body, Date.now()); });
route('uploaded', function (body) { return archive.markUploaded(body.batch_id, body, Date.now()); });
route('commit', function (body) { return archive.commitBatch(body.batch_id, body, Date.now()); });
route('restore-descriptor', function (body) { return archive.restoreDescriptor(body.batchId); });
route('retention-due', function (body) { return archive.retentionDue(body.cutoffIso, body.limit, body.cursor || '', Date.now()); });
route('retention-confirm', function (body) { return archive.confirmRetention(body, Date.now()); });

cronAdd('mail-archive-nonce-cleanup', '11 * * * *', function () {
  $app.runInTransaction(function (txDao) { auth.cleanupExpiredNonces(txDao, Date.now(), 500); });
});
cronAdd('mail-archive-retention-tombstone-cleanup', '23 3 * * *', function () {
  archive.cleanupRetentionTombstones(Date.now(), 5000);
});
})();
