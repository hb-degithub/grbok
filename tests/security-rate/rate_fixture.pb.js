routerAdd('GET', '/api/test/security-rate/rate', function (c) {
  try {
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    function assert(condition, message) {
      if (!condition) throw new Error('RATE_FIXTURE: ' + message);
    }
    function unavailable(raw, nowMs) {
      var failed = false;
      try { rate._parseEvents(raw, nowMs); } catch (error) {
        failed = error && error.name === 'RateLimitUnavailableError';
      }
      assert(failed, 'corrupt event payload must fail closed');
    }

    var nowMs = 1720828800000;
    assert(rate.normalizeEmail(' Reader@Example.COM ') === 'reader@example.com', 'email normalization');
    assert(rate.normalizeIp('192.0.2.001') === '192.0.2.1', 'IPv4 normalization');
    assert(rate.normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001') === '2001:db8::1', 'IPv6 normalization');
    assert(rate.ipv6Prefix64('2001:db8:abcd:12:ffff::1') === '2001:db8:abcd:12::/64', 'IPv6 /64');
    assert(rate._parseEvents(JSON.stringify([nowMs - 900000, nowMs - 899999]), nowMs).length === 2, 'valid events parse');
    assert(rate._pruneEvents([nowMs - 900000, nowMs - 899999], nowMs, 900).length === 1, 'exact boundary expires');
    unavailable('{', nowMs);
    unavailable(JSON.stringify(new Array(302).join('0').split('').map(function () { return nowMs; })), nowMs);
    unavailable('[' + new Array(17000).join('0') + ']', nowMs);
    unavailable(JSON.stringify([nowMs - 1, 1.5]), nowMs);
    unavailable(JSON.stringify([nowMs, nowMs - 1]), nowMs);
    unavailable(JSON.stringify([nowMs + 5001]), nowMs);

    var atomicEntries = [
      { policyKey: 'account_mail_email', subject: 'atomic@example.com' },
      { policyKey: 'account_mail_ip', subject: '192.0.2.88' },
      { policyKey: 'account_mail_global', subject: 'atomic-v1' },
    ];
    var injected = false;
    try {
      $app.dao().runInTransaction(function (txDao) {
        var saves = 0;
        var wrapper = {
          findRecordsByFilter: function () { return txDao.findRecordsByFilter.apply(txDao, arguments); },
          findCollectionByNameOrId: function () { return txDao.findCollectionByNameOrId.apply(txDao, arguments); },
          saveRecord: function (record) {
            saves++;
            if (saves === 2) throw new Error('INJECTED_SAVE_FAILURE');
            return txDao.saveRecord(record);
          },
        };
        rate.consume(wrapper, { nowMs: nowMs, entries: atomicEntries });
      });
    } catch (_) {
      injected = true;
    }
    assert(injected, 'injected save failure must escape and rollback');
    for (var a = 0; a < atomicEntries.length; a++) {
      var rows = $app.dao().findRecordsByFilter(
        'security_rate_buckets',
        'policy = {:policy} && subject_hash = {:hash}',
        '', 2, 0,
        { policy: atomicEntries[a].policyKey, hash: rate._subjectHash(atomicEntries[a].policyKey, atomicEntries[a].subject) },
      );
      assert(rows.length === 0, 'injected failure left a partial bucket write');
    }

    var bucketCollection = $app.dao().findCollectionByNameOrId('security_rate_buckets');
    var cleanupNow = Date.now();
    var expiredBucket = new Record(bucketCollection);
    expiredBucket.set('policy', 'account_mail_ip'); expiredBucket.set('subject_hash', rate._subjectHash('account_mail_ip', 'cleanup-expired'));
    expiredBucket.set('events_json', '[]'); expiredBucket.set('expires_at', new Date(cleanupNow - 1).toISOString()); $app.dao().saveRecord(expiredBucket);
    var activeBucket = new Record(bucketCollection);
    activeBucket.set('policy', 'account_mail_ip'); activeBucket.set('subject_hash', rate._subjectHash('account_mail_ip', 'cleanup-active'));
    activeBucket.set('events_json', '[]'); activeBucket.set('expires_at', new Date(cleanupNow + 60000).toISOString()); $app.dao().saveRecord(activeBucket);
    var cleaned = rate.cleanupExpired($app.dao(), cleanupNow);
    assert(cleaned >= 1, 'cleanup did not delete expired buckets');
    var expiredMissing = false;
    try { $app.dao().findRecordById('security_rate_buckets', expiredBucket.id); } catch (_) { expiredMissing = true; }
    assert(expiredMissing, 'cleanup retained expired bucket');
    assert($app.dao().findRecordById('security_rate_buckets', activeBucket.id).id === activeBucket.id, 'cleanup deleted active bucket');
    assert(rate.cleanupExpired($app.dao(), cleanupNow) === 0, 'cleanup must be idempotent');

    return c.json(200, { ok: true, boundary: true, corruption: true, rollback: true, cleanup: true });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('POST', '/api/test/security-rate/rate/consume', function (c) {
  try {
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    var input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
    var email = rate.normalizeEmail(String(input.email || 'reader@example.com'));
    var ip = rate.normalizeIp(String(input.ip || '192.0.2.10'));
    var result;
    $app.dao().runInTransaction(function (txDao) {
      result = rate.consume(txDao, {
        nowMs: Date.now(),
        entries: [
          { policyKey: 'account_mail_email', subject: email },
          { policyKey: 'account_mail_ip', subject: ip },
          { policyKey: 'account_mail_global', subject: 'v1' },
        ],
      });
    });
    return c.json(200, { ok: true, result: result });
  } catch (error) {
    return c.json(503, { ok: false, error: String(error && error.name ? error.name : error) });
  }
});

routerAdd('GET', '/api/test/security-rate/rate/summary', function (c) {
  try {
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    var email = rate.normalizeEmail(String(c.queryParam('email') || 'reader@example.com'));
    var ip = rate.normalizeIp(String(c.queryParam('ip') || '192.0.2.10'));
    var entries = [
      ['account_mail_email', email],
      ['account_mail_ip', ip],
      ['account_mail_global', 'v1'],
    ];
    var counts = {};
    for (var i = 0; i < entries.length; i++) {
      var records = $app.dao().findRecordsByFilter(
        'security_rate_buckets',
        'policy = {:policy} && subject_hash = {:hash}',
        '', 2, 0,
        { policy: entries[i][0], hash: rate._subjectHash(entries[i][0], entries[i][1]) },
      );
      counts[entries[i][0]] = records.length ? JSON.parse(String(records[0].get('events_json'))).length : 0;
    }
    return c.json(200, { ok: true, counts: counts });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});
