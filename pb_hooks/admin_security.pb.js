/// <reference path="../pb_data/types.d.ts" />

// 管理员二次验证（TOTP）路由。
// step-up/status 与 step-up/revoke 路由沿用原路径（前端与下游钩子无感知），
// Passkey 相关路由已移除，替换为 /totp/* 四链路。

routerAdd('GET', '/api/blog-admin/step-up/status', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').stepUpStatus(c);
});
routerAdd('POST', '/api/blog-admin/step-up/revoke', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').revokeStepUpSession(c);
});
routerAdd('POST', '/api/blog-admin/totp/setup', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').totpSetup(c);
});
routerAdd('POST', '/api/blog-admin/totp/confirm', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').totpConfirm(c);
});
routerAdd('POST', '/api/blog-admin/totp/verify', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').totpVerify(c);
});
routerAdd('POST', '/api/blog-admin/totp/revoke', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').totpRevoke(c);
});
routerAdd('POST', '/api/blog-admin/local-recovery', function (c) {
  return require(__hooks + '/lib/admin_totp_security.js').localRecovery(c);
});
