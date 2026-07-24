(function () {
'use strict';

routerAdd('GET', '/api/test/guestbook/contract', function (c) {
  try {
    function fail(message) { throw new Error('GUESTBOOK_FIXTURE: ' + message); }
    function assert(condition, message) { if (!condition) fail(message); }
    function equal(actual, expected, message) {
      if (actual !== expected) fail(message + ' expected=' + expected + ' actual=' + actual);
    }

    var store = require(__hooks + '/lib/security_policy_store.js');
    var current = store.getRatePolicySet($app.dao());
    assert(!current.degraded, 'policy set degraded');
    var policy = current.policies.guestbook_ip;
    var bounds = store.BOUNDS.guestbook_ip;
    assert(policy, 'guestbook_ip policy missing');
    assert(bounds, 'guestbook_ip bounds missing');
    equal(policy.limit, 5, 'default limit');
    equal(policy.windowSeconds, 3600, 'default window');
    equal(bounds.minLimit, 1, 'minimum limit');
    equal(bounds.maxLimit, 10, 'maximum limit');
    equal(bounds.minWindow, 3600, 'minimum window');
    equal(bounds.maxWindow, 3600, 'maximum window');

    var collection = $app.dao().findCollectionByNameOrId('guestbook_messages');
    equal(String(collection.listRule), 'status = "show"', 'list rule');
    equal(String(collection.viewRule), 'status = "show"', 'view rule');
    equal(String(collection.createRule), '', 'create rule');
    equal(String(collection.updateRule), '@request.auth.role = "super_admin"', 'update rule');
    equal(String(collection.deleteRule), '@request.auth.role = "super_admin"', 'delete rule');
    var names = ['nickname', 'content', 'status'];
    for (var i = 0; i < names.length; i++) {
      assert(collection.schema.getFieldByName(names[i]), 'missing field ' + names[i]);
    }
    var forbidden = ['ip', 'ip_hash', 'request_ip', 'ua', 'user_agent', 'fingerprint'];
    for (var j = 0; j < forbidden.length; j++) {
      assert(!collection.schema.getFieldByName(forbidden[j]), 'sensitive field present ' + forbidden[j]);
    }

    return c.json(200, {
      ok: true,
      policy: policy,
      bounds: bounds,
      version: current.version,
    });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message || error) });
  }
});

routerAdd('POST', '/api/test/guestbook/reset', function (c) {
  var messages = $app.dao().findRecordsByFilter('guestbook_messages', 'id != ""', 'created', 500, 0);
  var buckets = $app.dao().findRecordsByFilter(
    'security_rate_buckets', 'policy = {:policy}', 'created', 500, 0, { policy: 'guestbook_ip' },
  );
  for (var i = 0; i < messages.length; i++) $app.dao().deleteRecord(messages[i]);
  for (var j = 0; j < buckets.length; j++) $app.dao().deleteRecord(buckets[j]);
  return c.json(200, { ok: true });
});

routerAdd('POST', '/api/test/guestbook/seed-hidden', function (c) {
  var collection = $app.dao().findCollectionByNameOrId('guestbook_messages');
  var record = new Record(collection);
  record.set('nickname', 'Hidden fixture');
  record.set('content', 'Hidden fixture message');
  record.set('status', 'hidden');
  $app.dao().saveRecord(record);
  return c.json(200, { ok: true, id: record.id });
});

routerAdd('POST', '/api/test/guestbook/backdate', function (c) {
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var ip = rate.normalizeIp(String(c.realIP() || '').trim());
  var rows = $app.dao().findRecordsByFilter(
    'security_rate_buckets',
    'policy = {:policy} && subject_hash = {:hash}',
    '', 2, 0,
    { policy: 'guestbook_ip', hash: rate._subjectHash('guestbook_ip', ip) },
  );
  if (rows.length !== 1) throw new Error('GUESTBOOK_FIXTURE: backdate bucket count');
  var events = JSON.parse(String(rows[0].get('events_json')));
  var expired = Date.now() - 3600001;
  rows[0].set('events_json', JSON.stringify(events.map(function () { return expired; })));
  rows[0].set('expires_at', new Date(Date.now() - 1).toISOString());
  $app.dao().saveRecord(rows[0]);
  return c.json(200, { ok: true, events: events.length });
});

routerAdd('POST', '/api/test/guestbook/corrupt', function (c) {
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var ip = rate.normalizeIp(String(c.realIP() || '').trim());
  var rows = $app.dao().findRecordsByFilter(
    'security_rate_buckets',
    'policy = {:policy} && subject_hash = {:hash}',
    '', 2, 0,
    { policy: 'guestbook_ip', hash: rate._subjectHash('guestbook_ip', ip) },
  );
  if (rows.length !== 1) throw new Error('GUESTBOOK_FIXTURE: corrupt bucket count');
  rows[0].set('events_json', '{');
  rows[0].set('expires_at', new Date(Date.now() + 3600000).toISOString());
  $app.dao().saveRecord(rows[0]);
  var messages = $app.dao().findRecordsByFilter('guestbook_messages', 'id != ""', 'created', 500, 0);
  return c.json(200, { ok: true, messages: messages.length });
});

routerAdd('GET', '/api/test/guestbook/storage', function (c) {
  var rate = require(__hooks + '/lib/security_rate_limit.js');
  var ip = rate.normalizeIp(String(c.realIP() || '').trim());
  var messages = $app.dao().findRecordsByFilter('guestbook_messages', 'id != ""', 'created', 500, 0);
  var buckets = $app.dao().findRecordsByFilter(
    'security_rate_buckets', 'policy = {:policy}', 'created', 500, 0, { policy: 'guestbook_ip' },
  );
  var rawIpFoundInGuestbookRows = false;
  var rawIpFoundInBucketRows = false;
  for (var i = 0; i < messages.length; i++) {
    var messageValues = [messages[i].get('nickname'), messages[i].get('content'), messages[i].get('status')];
    if (JSON.stringify(messageValues).indexOf(ip) !== -1) rawIpFoundInGuestbookRows = true;
  }
  for (var j = 0; j < buckets.length; j++) {
    var bucketValues = [buckets[j].get('policy'), buckets[j].get('subject_hash'), buckets[j].get('events_json'), buckets[j].get('expires_at')];
    if (JSON.stringify(bucketValues).indexOf(ip) !== -1) rawIpFoundInBucketRows = true;
  }
  return c.json(200, {
    ok: true,
    messages: messages.length,
    buckets: buckets.length,
    rawIpFoundInGuestbookRows: rawIpFoundInGuestbookRows,
    rawIpFoundInBucketRows: rawIpFoundInBucketRows,
  });
});

routerAdd('POST', '/api/test/guestbook/policy-six', function (c) {
  function copy(policies) {
    var result = {};
    Object.keys(policies).forEach(function (key) {
      result[key] = { limit: Number(policies[key].limit), windowSeconds: Number(policies[key].windowSeconds) };
    });
    return result;
  }

  var store = require(__hooks + '/lib/security_policy_store.js');
  var current = store.getRatePolicySet($app.dao());
  if (current.degraded) throw new Error('GUESTBOOK_FIXTURE: policy set degraded before update');
  var policies = copy(current.policies);
  policies.guestbook_ip = { limit: 6, windowSeconds: 3600 };
  var updated;
  $app.dao().runInTransaction(function (txDao) {
    updated = store.replaceRatePolicySet(txDao, {
      expectedVersion: current.version,
      policies: policies,
      actorId: 'guestbook_fixture',
      now: new Date(),
    });
  });
  return c.json(200, { ok: true, version: updated.version, policy: updated.policies.guestbook_ip });
});

routerAdd('GET', '/api/test/guestbook/policy-constraints', function (c) {
  try {
    function fail(message) { throw new Error('GUESTBOOK_FIXTURE: ' + message); }
    function equal(actual, expected, message) {
      if (actual !== expected) fail(message + ' expected=' + expected + ' actual=' + actual);
    }
    function copy(policies) {
      var result = {};
      Object.keys(policies).forEach(function (key) {
        result[key] = { limit: Number(policies[key].limit), windowSeconds: Number(policies[key].windowSeconds) };
      });
      return result;
    }
    function expectCode(callback, expected) {
      var actual = '';
      try {
        callback();
      } catch (error) {
        actual = String(error && error.code || '');
      }
      equal(actual, expected, 'error code');
    }

    var store = require(__hooks + '/lib/security_policy_store.js');
    var current = store.getRatePolicySet($app.dao());
    if (current.degraded) fail('policy set degraded before bounds checks');

    function replaceGuestbook(limit, windowSeconds, expectedVersion) {
      var policies = copy(current.policies);
      policies.guestbook_ip = { limit: limit, windowSeconds: windowSeconds };
      return store.replaceRatePolicySet($app.dao(), {
        expectedVersion: expectedVersion,
        policies: policies,
        actorId: 'guestbook_fixture',
        now: new Date(),
      });
    }

    expectCode(function () { replaceGuestbook(0, 3600, current.version); }, 'POLICY_OUT_OF_SAFE_RANGE');
    expectCode(function () { replaceGuestbook(11, 3600, current.version); }, 'POLICY_OUT_OF_SAFE_RANGE');
    expectCode(function () { replaceGuestbook(5, 1800, current.version); }, 'POLICY_OUT_OF_SAFE_RANGE');
    expectCode(function () { replaceGuestbook(5, 3600, current.version - 1); }, 'POLICY_VERSION_CONFLICT');
    return c.json(200, { ok: true, version: current.version });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message || error) });
  }
});
})();
