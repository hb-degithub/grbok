routerAdd('GET', '/api/test/security-rate/admin-policy', function (c) {
  try {
    var core = require(__hooks + '/lib/security_policy_admin.js');
    var store = require(__hooks + '/lib/security_policy_store.js');
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    var modeStore = require(__hooks + '/lib/registration_mode.js');
    var modeCollection = $app.dao().findCollectionByNameOrId('security_registration_mode');
    if (modeCollection.listRule !== null || modeCollection.viewRule !== null || modeCollection.createRule !== null || modeCollection.updateRule !== null || modeCollection.deleteRule !== null) throw new Error('registration mode collection must be server-only');
    var modeRows = $app.dao().findRecordsByFilter('security_registration_mode', 'id != ""', '', 10, 0);
    if (modeRows.length !== 1 || modeStore.getRegistrationMode($app.dao()).mode !== 'open') throw new Error('registration mode singleton mismatch');
    var legacySettings = $app.dao().findRecordsByFilter('settings', 'key = "security_registration_mode"', '', 1, 0);
    var legacy = legacySettings.length ? legacySettings[0] : new Record($app.dao().findCollectionByNameOrId('settings'));
    legacy.set('key', 'security_registration_mode'); legacy.set('value', { mode: 'invite_only', version: 999 }); legacy.set('description', 'must be ignored'); $app.dao().saveRecord(legacy);
    if (modeStore.getRegistrationMode($app.dao()).mode !== 'open') throw new Error('generic settings changed private registration mode');
    var usersCollection = $app.dao().findCollectionByNameOrId('users');
    var ordinaryAdmin = new Record(usersCollection);
    ordinaryAdmin.set('email', 'ordinary-mode-admin@example.com'); ordinaryAdmin.set('username', 'ordinary_mode_admin'); ordinaryAdmin.set('password', 'Test12345!'); ordinaryAdmin.set('passwordConfirm', 'Test12345!'); ordinaryAdmin.set('name', 'Ordinary Admin'); ordinaryAdmin.set('role', 'admin'); ordinaryAdmin.set('verified', true); ordinaryAdmin.refreshTokenKey(); $app.dao().saveRecord(ordinaryAdmin);
    var loopback = String($os.getenv('BLOG_AUTH_LOOPBACK_BASE') || 'http://127.0.0.1:8090').replace(/\/$/, '');
    var token = $tokens.recordAuthToken($app, ordinaryAdmin);
    var directList = $http.send({ url: loopback + '/api/collections/security_registration_mode/records', method: 'GET', headers: { Authorization: token } });
    var directCreate = $http.send({ url: loopback + '/api/collections/security_registration_mode/records', method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'invite_only', version: 2, updated_by: ordinaryAdmin.id, updated_at: new Date().toISOString() }) });
    var settingsPatch = $http.send({ url: loopback + '/api/collections/settings/records/' + legacy.id, method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: { mode: 'invite_only', version: 1000 } }) });
    if (directList.statusCode < 400 || directCreate.statusCode < 400 || settingsPatch.statusCode < 400) throw new Error('ordinary admin bypassed server-only registration mode');
    var corruptClosed = false;
    try {
      modeStore.getRegistrationMode({ findRecordsByFilter: function () { return [{ getString: function (field) { return field === 'mode' ? 'broken' : ''; }, getInt: function () { return 0; } }]; } });
    } catch (error) { corruptClosed = error && error.code === 'REGISTRATION_MODE_UNAVAILABLE'; }
    if (!corruptClosed) throw new Error('corrupt registration mode did not fail closed');
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
    return c.json(200, { ok: true, privateMode: true, corruptClosed: true, auditRollback: true, bounds: true, version: version, sixthLimited: true, mode: mode });
  } catch (error) { return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) }); }
});
