(function () {
routerAdd('GET', '/api/test/security-rate/registration', function (c) {
  try {
    var mode = require(__hooks + '/lib/registration_mode.js');
    var current = mode.getRegistrationMode($app.dao());
    if (current.mode !== 'open' || current.version !== 1) throw new Error('default registration mode mismatch');
    return c.json(200, { ok: true, mode: current });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('POST', '/api/test/security-rate/registration/consume', function (c) {
  try {
    var input = JSON.parse(readerToString(c.request().body, 8192) || '{}');
    var facade = require(__hooks + '/lib/registration_facade.js');
    var result;
    $app.dao().runInTransaction(function (txDao) {
      result = facade._consumeRegistrationLimits(txDao, String(input.ip || ''), Number(input.nowMs || Date.now()));
    });
    return c.json(result.allowed ? 200 : 429, result);
  } catch (error) {
    return c.json(503, { allowed: false, code: 'REGISTRATION_UNAVAILABLE', error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('POST', '/api/test/security-rate/registration/register', function (c) {
  var facade = require(__hooks + '/lib/registration_facade.js');
  return facade.handle(c, {
    ip: String(c.request().header.get('X-Test-IP') || ''),
    accountRetention: { initializeNewUser: function () {} },
  });
}, $apis.bodyLimit(8192));

routerAdd('GET', '/api/test/security-rate/registration/state', function (c) {
  var users = $app.dao().findRecordsByFilter('users', 'role = "reader"', 'created', 500, 0);
  var logs = $app.dao().findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 500, 0);
  return c.json(200, { users: users.length, logs: logs.length });
});

routerAdd('POST', '/api/test/security-rate/registration/reset', function (c) {
  var names = ['security_rate_buckets', 'mail_delivery_logs'];
  for (var n = 0; n < names.length; n++) {
    var rows = $app.dao().findRecordsByFilter(names[n], 'id != ""', 'created', 500, 0);
    for (var i = 0; i < rows.length; i++) $app.dao().deleteRecord(rows[i]);
  }
  return c.json(200, { ok: true });
});

routerAdd('POST', '/api/test/security-rate/registration/prime-mail', function (c) {
  var input = JSON.parse(readerToString(c.request().body, 8192) || '{}');
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var email = rate.normalizeEmail(String(input.email || ''));
  var ip = rate.normalizeIp(String(input.ip || '192.0.2.90'));
  for (var i = 0; i < 2; i++) {
    $app.dao().runInTransaction(function (txDao) {
      var result = rate.consume(txDao, { nowMs: Date.now(), entries: [
        { policyKey: 'account_mail_email', subject: email },
        { policyKey: 'account_mail_ip', subject: ip },
        { policyKey: 'account_mail_global', subject: 'v1' },
      ] });
      if (!result.allowed) throw new Error('unable to prime account-mail quota');
    });
  }
  return c.json(200, { ok: true });
});

routerAdd('POST', '/api/test/security-rate/registration/corrupt', function (c) {
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var input = JSON.parse(readerToString(c.request().body, 8192) || '{}');
  var ip = rate.normalizeIp(String(input.ip || '192.0.2.250'));
  var collection = $app.dao().findCollectionByNameOrId('security_rate_buckets');
  var record = new Record(collection);
  record.set('policy', 'registration_ip');
  record.set('subject_hash', rate._subjectHash('registration_ip', ip));
  record.set('events_json', '{');
  record.set('expires_at', new Date(Date.now() + 3600000).toISOString());
  $app.dao().saveRecord(record);
  return c.json(200, { ok: true });
});
})();
