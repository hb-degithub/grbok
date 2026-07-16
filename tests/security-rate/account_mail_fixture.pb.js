routerAdd('GET', '/api/test/security-rate/account-mail', function (c) {
  try {
    function fixtureCreateUser(label, verified, role) {
      var users = $app.dao().findCollectionByNameOrId('users');
      var record = new Record(users);
      var email = label + '@example.com';
      record.set('email', email);
      record.set('username', label);
      record.set('password', 'Test12345!');
      record.set('passwordConfirm', 'Test12345!');
      record.set('name', label);
      record.set('role', role);
      record.set('verified', verified);
      record.refreshTokenKey();
      $app.dao().saveRecord(record);
      return email;
    }
    var publicErrors = require(__hooks + '/lib/public_errors.js');
    var logs = require(__hooks + '/lib/mail_logs.js');
    var collection = $app.dao().findCollectionByNameOrId('mail_delivery_logs');
    var required = ['event_id', 'category', 'source_kind', 'result', 'duration_ms', 'attempt', 'error_class', 'archive_batch_id'];
    var removed = ['request_id', 'source_collection', 'source_record_id', 'recipient_masked', 'recipient_hash', 'request_ip_hash', 'rate_limited', 'decoy'];
    for (var i = 0; i < required.length; i++) {
      if (!collection.schema.getFieldByName(required[i])) throw new Error('missing minimal log field ' + required[i]);
    }
    for (var j = 0; j < removed.length; j++) {
      if (collection.schema.getFieldByName(removed[j])) throw new Error('sensitive legacy log field remains ' + removed[j]);
    }
    var eventId = publicErrors.referenceId();
    logs.delivery({
      event_id: eventId,
      category: 'admin_test',
      source_kind: 'admin',
      result: 'sent',
      duration_ms: 12,
      attempt: 1,
      error_class: 'none',
    });
    var row = $app.dao().findFirstRecordByData('mail_delivery_logs', 'event_id', eventId);
    if (!row || row.getString('event_id') !== eventId) throw new Error('minimal delivery log not stored');
    $app.dao().deleteRecord(row);

    return c.json(200, {
      ok: true,
      existing: fixtureCreateUser('mail_existing', true, 'reader'),
      gatewayFailure: fixtureCreateUser('gatewayfail', true, 'reader'),
      noneligible: fixtureCreateUser('mail_admin', true, 'admin'),
      authenticated: (function () {
        var email = fixtureCreateUser('mail_authenticated', true, 'reader');
        var record = $app.dao().findFirstRecordByData('users', 'email', email);
        return { email: email, token: $tokens.recordAuthToken($app, record) };
      })(),
      unverified: (function () {
        var email = fixtureCreateUser('mail_unverified', false, 'reader');
        var record = $app.dao().findFirstRecordByData('users', 'email', email);
        return { email: email, token: $tokens.recordAuthToken($app, record) };
      })(),
      requestIp: String(c.realIP() || ''),
    });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('GET', '/api/test/security-rate/account-mail/state', function (c) {
  var logs = $app.dao().findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 500, 0);
  var challenges = $app.dao().findRecordsByFilter('auth_otp_challenges', 'id != ""', 'created', 500, 0);
  return c.json(200, {
    ok: true,
    logs: logs.map(function (row) {
      return {
        category: row.getString('category'),
        result: row.getString('result'),
        sourceKind: row.getString('source_kind'),
        errorClass: row.getString('error_class'),
      };
    }),
    challenges: challenges.length,
  });
});

routerAdd('POST', '/api/test/security-rate/account-mail/reset-buckets', function (c) {
  var rows = $app.dao().findRecordsByFilter('security_rate_buckets', 'id != ""', 'created', 500, 0);
  for (var i = 0; i < rows.length; i++) $app.dao().deleteRecord(rows[i]);
  return c.json(200, { ok: true, deleted: rows.length });
});

routerAdd('POST', '/api/test/security-rate/account-mail/corrupt', function (c) {
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var collection = $app.dao().findCollectionByNameOrId('security_rate_buckets');
  var record = new Record(collection);
  record.set('policy', 'account_mail_email');
  record.set('subject_hash', rate._subjectHash('account_mail_email', 'corrupt@example.com'));
  record.set('events_json', '{');
  record.set('expires_at', new Date(Date.now() + 900000).toISOString());
  $app.dao().saveRecord(record);
  return c.json(200, { ok: true });
});

routerAdd('POST', '/api/test/security-rate/account-mail/prime', function (c) {
  var input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var count = Number(input.count || 0);
  for (var i = 0; i < count; i++) {
    $app.dao().runInTransaction(function (txDao) {
      var result = rate.consume(txDao, { nowMs: Date.now(), entries: [{ policyKey: String(input.policyKey || ''), subject: String(input.subject || '') }] });
      if (!result.allowed) throw new Error('prime denied early');
    });
  }
  return c.json(200, { ok: true });
});

routerAdd('POST', '/internal/mail/send', function (c) {
  try {
    var body = JSON.parse(readerToString(c.request().body, 262144) || '{}');
    if (String(body.to || '') === 'gatewayfail@example.com') {
      return c.json(503, { ok: false, error: { code: 'SMTP_CONNECTION', retryable: true } });
    }
    return c.json(202, { ok: true, requestId: String(body.requestId || '') });
  } catch (_) {
    return c.json(400, { ok: false, error: { code: 'PAYLOAD_INVALID', retryable: false } });
  }
});
