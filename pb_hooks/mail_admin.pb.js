/// <reference path="../pb_data/types.d.ts" />

var mailAdmin = require(__hooks + '/lib/mail_admin.js');

routerAdd('GET', '/api/blog-admin/mail/overview', function (c) {
  return mailAdmin.overview(c);
});

routerAdd('GET', '/api/blog-admin/mail/queue', function (c) {
  return mailAdmin.queue(c);
});

routerAdd('GET', '/api/blog-admin/mail/logs', function (c) {
  return mailAdmin.logs(c);
});

routerAdd('POST', '/api/blog-admin/mail/verify', function (c) {
  return mailAdmin.verify(c);
});

routerAdd('GET', '/api/blog-admin/mail/templates', function (c) {
  return mailAdmin.templates(c);
});

routerAdd('GET', '/api/blog-admin/mail/rules', function (c) {
  return mailAdmin.rules(c);
});

routerAdd('GET', '/api/blog-admin/mail/suppress', function (c) {
  return mailAdmin.suppress(c);
});