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