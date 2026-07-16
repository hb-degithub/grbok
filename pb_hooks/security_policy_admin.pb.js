(function () {
  function dependencies(c, actionCode) {
    var stepUp = require(__hooks + '/lib/admin_step_up.js');
    var audit = require(__hooks + '/lib/admin_security_audit.js');
    var security = stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireTrustedAdminIp: true, actionCode: actionCode });
    security.writeAudit = audit.writeSecurityAudit;
    security.nowMs = Date.now();
    return security;
  }
  function body(c) { return JSON.parse(readerToString(c.request().body, 131072) || '{}'); }
  function failure(c, error) {
    var code = String(error && error.code || 'INTERNAL_ERROR');
    if (code === 'POLICY_OUT_OF_SAFE_RANGE' || code === 'INVALID_REGISTRATION_MODE') return c.json(422, { code: code });
    if (code === 'POLICY_VERSION_CONFLICT' || code === 'REGISTRATION_MODE_VERSION_CONFLICT') return c.json(409, { code: code });
    if (code === 'ADMIN_OPERATION_RATE_LIMITED') return c.json(429, { code: code, retryAfter: Number(error.retryAfter || 1) });
    throw error;
  }
  routerAdd('GET', '/api/blog-admin/security/rate-policy', function (c) {
    dependencies(c, 'RATE_POLICY_VIEWED');
    var store = require(__hooks + '/lib/security_policy_store.js');
    var current = store.getRatePolicySet($app.dao());
    return c.json(200, { version: current.version, policies: current.policies, bounds: store.BOUNDS });
  });
  routerAdd('PUT', '/api/blog-admin/security/rate-policy', function (c) {
    var security = dependencies(c, 'RATE_POLICY_UPDATED');
    try {
      var input = body(c); var result;
      $app.dao().runInTransaction(function (txDao) { result = require(__hooks + '/lib/security_policy_admin.js').updatePolicies(txDao, { expectedVersion: input.version, policies: input.policies }, security); });
      return c.json(200, result);
    } catch (error) { return failure(c, error); }
  }, $apis.bodyLimit(131072));
  routerAdd('GET', '/api/blog-admin/security/registration-mode', function (c) {
    dependencies(c, 'REGISTRATION_MODE_VIEWED');
    return c.json(200, require(__hooks + '/lib/registration_mode.js').getRegistrationMode($app.dao()));
  });
  routerAdd('PUT', '/api/blog-admin/security/registration-mode', function (c) {
    var security = dependencies(c, 'REGISTRATION_MODE_UPDATED');
    try {
      var input = body(c); var result;
      $app.dao().runInTransaction(function (txDao) { result = require(__hooks + '/lib/security_policy_admin.js').updateRegistrationMode(txDao, { expectedVersion: input.version, mode: input.mode }, security); });
      return c.json(200, result);
    } catch (error) { return failure(c, error); }
  }, $apis.bodyLimit(8192));
})();
