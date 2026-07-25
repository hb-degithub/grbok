/// <reference path="../pb_data/types.d.ts" />

// 邮件归档内部 API（供离线归档脚本签名调用）。
// 注意：handler 内 require + 路径字面量内联（JSVM 下顶层变量对 handler 与 cron 不可见）。

routerAdd('POST', '/api/blog-internal/mail-archive/status', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/status', function (body) {
    var archive = require(__hooks + '/lib/mail_archive.js');
    return body.batch_id ? archive.getBatchStatus(body.batch_id) : (archive.getPendingBatch() || { empty: true });
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/prepare', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/prepare', function (body) {
    return require(__hooks + '/lib/mail_archive.js').prepareBatch(Date.now(), body.limit || 5000) || { empty: true };
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/export', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/export', function (body) {
    return require(__hooks + '/lib/mail_archive.js').exportBatch(body.batch_id);
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/seal', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/seal', function (body) {
    return require(__hooks + '/lib/mail_archive.js').sealBatch(body.batch_id, body, Date.now());
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/uploaded', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/uploaded', function (body) {
    return require(__hooks + '/lib/mail_archive.js').markUploaded(body.batch_id, body, Date.now());
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/commit', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/commit', function (body) {
    return require(__hooks + '/lib/mail_archive.js').commitBatch(body.batch_id, body, Date.now());
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/restore-descriptor', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/restore-descriptor', function (body) {
    return require(__hooks + '/lib/mail_archive.js').restoreDescriptor(body.batchId);
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/retention-due', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/retention-due', function (body) {
    return require(__hooks + '/lib/mail_archive.js').retentionDue(body.cutoffIso, body.limit, body.cursor || '', Date.now());
  });
}, $apis.bodyLimit(65536));

routerAdd('POST', '/api/blog-internal/mail-archive/retention-confirm', function (e) {
  return require(__hooks + '/lib/mail_archive_auth.js').handleSignedRoute(e, '/api/blog-internal/mail-archive/retention-confirm', function (body) {
    return require(__hooks + '/lib/mail_archive.js').confirmRetention(body, Date.now());
  });
}, $apis.bodyLimit(65536));

cronAdd('mail-archive-nonce-cleanup', '11 * * * *', function () {
  $app.dao().runInTransaction(function (txDao) {
    require(__hooks + '/lib/mail_archive_auth.js').cleanupExpiredNonces(txDao, Date.now(), 500);
  });
});

cronAdd('mail-archive-retention-tombstone-cleanup', '23 3 * * *', function () {
  require(__hooks + '/lib/mail_archive.js').cleanupRetentionTombstones(Date.now(), 5000);
});
