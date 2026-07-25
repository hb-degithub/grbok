/// <reference path="../pb_data/types.d.ts" />

// 邮件治理路由。注意：handler 内 require（JSVM 下顶层 var 对 handler 不可见，沿用 admin_security.pb.js 的模式）。

routerAdd('GET', '/api/blog-admin/mail/overview', function (c) {
  return require(__hooks + '/lib/mail_admin.js').overview(c);
});

routerAdd('GET', '/api/blog-admin/mail/queue', function (c) {
  return require(__hooks + '/lib/mail_admin.js').queue(c);
});

routerAdd('GET', '/api/blog-admin/mail/logs', function (c) {
  return require(__hooks + '/lib/mail_admin.js').logs(c);
});

routerAdd('POST', '/api/blog-admin/mail/verify', function (c) {
  return require(__hooks + '/lib/mail_admin.js').verify(c);
});

routerAdd('GET', '/api/blog-admin/mail/templates', function (c) {
  return require(__hooks + '/lib/mail_admin.js').templates(c);
});

routerAdd('GET', '/api/blog-admin/mail/rules', function (c) {
  return require(__hooks + '/lib/mail_admin.js').rules(c);
});

routerAdd('GET', '/api/blog-admin/mail/suppress', function (c) {
  return require(__hooks + '/lib/mail_admin.js').suppress(c);
});

routerAdd('GET', '/api/blog-admin/mail/smtp', function (c) {
  return require(__hooks + '/lib/mail_admin.js').smtpRead(c);
});

routerAdd('PUT', '/api/blog-admin/mail/smtp', function (c) {
  return require(__hooks + '/lib/mail_admin.js').smtpSave(c);
});

routerAdd('PUT', '/api/blog-admin/mail/templates', function (c) {
  return require(__hooks + '/lib/mail_admin.js').templateUpdate(c);
});

routerAdd('POST', '/api/blog-admin/mail/test', function (c) {
  return require(__hooks + '/lib/mail_admin.js').sendTest(c);
});
