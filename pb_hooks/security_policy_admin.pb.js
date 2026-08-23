(function () {
// 安全策略管理端（仅 super_admin + step-up）：薄路由。
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到本 IIFE 的闭包变量，因此 helper 在 lib/security_policy_route_helpers.js，
// handler 内 require 调用（与 blog_auth.pb.js 等一致）。
routerAdd('GET', '/api/blog-admin/security/rate-policy', function (c) {
  var helpers = require(__hooks + '/lib/security_policy_route_helpers.js');
  helpers.dependencies(c, 'RATE_POLICY_VIEWED');
  var store = require(__hooks + '/lib/security_policy_store.js');
  var current = store.getRatePolicySet($app.dao());
  return c.json(200, { version: current.version, policies: current.policies, bounds: store.BOUNDS });
});
routerAdd('PUT', '/api/blog-admin/security/rate-policy', function (c) {
  var helpers = require(__hooks + '/lib/security_policy_route_helpers.js');
  var security = helpers.dependencies(c, 'RATE_POLICY_UPDATED');
  try {
    var input = helpers.body(c); var result;
    $app.dao().runInTransaction(function (txDao) { result = require(__hooks + '/lib/security_policy_admin.js').updatePolicies(txDao, { expectedVersion: input.version, policies: input.policies }, security); });
    return c.json(200, result);
  } catch (error) { return helpers.failure(c, error); }
}, $apis.bodyLimit(131072));
routerAdd('GET', '/api/blog-admin/security/registration-mode', function (c) {
  var helpers = require(__hooks + '/lib/security_policy_route_helpers.js');
  helpers.dependencies(c, 'REGISTRATION_MODE_VIEWED');
  return c.json(200, require(__hooks + '/lib/registration_mode.js').getRegistrationMode($app.dao()));
});
routerAdd('PUT', '/api/blog-admin/security/registration-mode', function (c) {
  var helpers = require(__hooks + '/lib/security_policy_route_helpers.js');
  var security = helpers.dependencies(c, 'REGISTRATION_MODE_UPDATED');
  try {
    var input = helpers.body(c); var result;
    $app.dao().runInTransaction(function (txDao) { result = require(__hooks + '/lib/security_policy_admin.js').updateRegistrationMode(txDao, { expectedVersion: input.version, mode: input.mode }, security); });
    return c.json(200, result);
  } catch (error) { return helpers.failure(c, error); }
}, $apis.bodyLimit(8192));
})();
