/// <reference path="../pb_data/types.d.ts" />

routerAdd('GET', '/api/blog-admin/step-up/status', function (c) {
  return require(__hooks + '/lib/admin_security.js').stepUpStatus(c);
});
routerAdd('POST', '/api/blog-admin/step-up/options', function (c) {
  return require(__hooks + '/lib/admin_security.js').authenticationOptions(c);
});
routerAdd('POST', '/api/blog-admin/step-up/verify', function (c) {
  return require(__hooks + '/lib/admin_security.js').authenticationVerify(c);
});
routerAdd('POST', '/api/blog-admin/step-up/revoke', function (c) {
  return require(__hooks + '/lib/admin_security.js').revokeStepUp(c);
});
routerAdd('GET', '/api/blog-admin/passkeys', function (c) {
  return require(__hooks + '/lib/admin_security.js').listPasskeys(c);
});
routerAdd('POST', '/api/blog-admin/passkeys/registration/options', function (c) {
  return require(__hooks + '/lib/admin_security.js').registrationOptions(c);
});
routerAdd('POST', '/api/blog-admin/passkeys/registration/verify', function (c) {
  return require(__hooks + '/lib/admin_security.js').registrationVerify(c);
});
routerAdd('POST', '/api/blog-admin/passkeys/:id/revoke', function (c) {
  return require(__hooks + '/lib/admin_security.js').revokePasskey(c);
});
