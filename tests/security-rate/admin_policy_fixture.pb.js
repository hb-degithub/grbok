routerAdd('GET', '/api/test/security-rate/admin-policy', function (c) {
  try {
    var core = require(__hooks + '/lib/security_policy_admin.js');
    var store = require(__hooks + '/lib/security_policy_store.js');
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    var initial = store.getRatePolicySet($app.dao());
    var policies = initial.policies;
    policies.account_mail_email = { limit: 3, windowSeconds: 900 };
    var rolledBack = false;
    try {
      $app.dao().runInTransaction(function (txDao) {
        core.updatePolicies(txDao, { expectedVersion: initial.version, policies: policies }, { actorId: 'actor-a', nowMs: Date.now(), writeAudit: function () { throw new Error('audit fail'); } });
      });
    } catch (_) { rolledBack = true; }
    if (!rolledBack || store.getRatePolicySet($app.dao()).version !== initial.version) throw new Error('audit rollback coupling failed');

    var invalid = false;
    var bad = store.getRatePolicySet($app.dao()).policies; bad.account_mail_email = { limit: 0, windowSeconds: 900 };
    try { $app.dao().runInTransaction(function (txDao) { core.updatePolicies(txDao, { expectedVersion: initial.version, policies: bad }, { actorId: 'actor-a', nowMs: Date.now(), writeAudit: function () {} }); }); }
    catch (error) { invalid = error && error.code === 'POLICY_OUT_OF_SAFE_RANGE'; }
    if (!invalid) throw new Error('invalid policy bounds accepted');

    var bucket;
    $app.dao().runInTransaction(function (txDao) {
      rate.consume(txDao, { nowMs: Date.now(), entries: [{ policyKey: 'account_mail_email', subject: 'bucket@example.com' }] });
    });
    bucket = $app.dao().findRecordsByFilter('security_rate_buckets', 'id != ""', '', 10, 0)[0];
    var version = initial.version;
    for (var i = 0; i < 5; i++) {
      var current = store.getRatePolicySet($app.dao());
      var next = current.policies;
      next.account_mail_email = { limit: i % 2 ? 2 : 3, windowSeconds: 900 };
      $app.dao().runInTransaction(function (txDao) {
        var updated = core.updatePolicies(txDao, { expectedVersion: version, policies: next }, { actorId: 'actor-b', nowMs: Date.now(), writeAudit: function () {} });
        version = updated.version;
      });
    }
    if (!$app.dao().findRecordById('security_rate_buckets', bucket.id)) throw new Error('policy update cleared buckets');
    var sixth = false;
    try {
      var currentSix = store.getRatePolicySet($app.dao());
      $app.dao().runInTransaction(function (txDao) { core.updatePolicies(txDao, { expectedVersion: currentSix.version, policies: currentSix.policies }, { actorId: 'actor-b', nowMs: Date.now(), writeAudit: function () {} }); });
    } catch (error) { sixth = error && error.code === 'ADMIN_OPERATION_RATE_LIMITED'; }
    if (!sixth) throw new Error('sixth admin write was not limited');

    var mode;
    $app.dao().runInTransaction(function (txDao) {
      mode = core.updateRegistrationMode(txDao, { expectedVersion: 1, mode: 'invite_only' }, { actorId: 'actor-c', referenceId: 'ref_admin_policy_fixture', nowMs: Date.now(), writeAudit: function () {} });
    });
    if (mode.mode !== 'invite_only' || mode.version !== 2) throw new Error('registration mode CAS failed');
    return c.json(200, { ok: true, auditRollback: true, bounds: true, version: version, sixthLimited: true, mode: mode });
  } catch (error) { return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) }); }
});
