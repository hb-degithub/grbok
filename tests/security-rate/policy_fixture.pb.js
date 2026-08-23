routerAdd('GET', '/api/test/security-rate/policy', function (c) {
    try {
      function fail(message) {
        throw new Error('POLICY_FIXTURE: ' + message);
      }
      function equal(actual, expected, message) {
        if (actual !== expected) {
          fail(message + ' (expected ' + String(expected) + ', got ' + String(actual) + ')');
        }
      }
      function assertPrivate(collection) {
        var rules = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];
        for (var i = 0; i < rules.length; i++) {
          equal(collection[rules[i]], null, collection.name + '.' + rules[i] + ' must be private');
        }
      }
      function hasIndex(collection, fragments) {
        var indexes = collection.indexes || [];
        for (var i = 0; i < indexes.length; i++) {
          var normalized = String(indexes[i]).toLowerCase().replace(/\s+/g, ' ');
          var found = true;
          for (var j = 0; j < fragments.length; j++) {
            if (normalized.indexOf(fragments[j]) === -1) found = false;
          }
          if (found) return true;
        }
        return false;
      }
      function expectCode(fn, code) {
        var actual = '';
        try {
          fn();
        } catch (error) {
          actual = String(error && error.code ? error.code : '');
        }
        equal(actual, code, 'expected error code ' + code);
      }
      var store = require(__hooks + '/lib/security_policy_store.js');
      var dao = $app.dao();
      var policies = dao.findCollectionByNameOrId('security_rate_policies');
      var buckets = dao.findCollectionByNameOrId('security_rate_buckets');
      assertPrivate(policies);
      assertPrivate(buckets);

      if (!hasIndex(buckets, ['unique index', 'policy', 'subject_hash'])) {
        fail('missing unique policy/subject_hash index');
      }
      if (!hasIndex(buckets, ['index', 'expires_at'])) {
        fail('missing expires_at index');
      }

      var current = store.getRatePolicySet(dao);
      var expected = {
        account_mail_email: [2, 900],
        account_mail_ip: [5, 900],
        account_mail_global: [30, 60],
        registration_ip: [3, 3600],
        registration_ipv6_64: [10, 3600],
        registration_global: [20, 60],
        guestbook_ip: [5, 3600],
        comment_ip: [5, 60],
        comment_email: [3, 60],
        comment_post: [12, 60],
        comment_report_ip: [5, 600],
        comment_like_ip: [10, 60],
        comment_edit_ip: [5, 300],
        comment_delete_ip: [3, 300],
        comment_verification_email: [1, 60],
        comment_verification_ip: [5, 60],
        admin_test_actor: [3, 3600],
        admin_test_global: [10, 86400],
        admin_security_write: [5, 3600],
        admin_totp_verify: [5, 300],
        admin_totp_lockout: [1, 900],
        comment_notification: [60, 60],
        comment_reply_notification: [60, 60],
        account_retention_notice: [10, 60],
        outbound_global: [60, 60],
      };
      equal(Object.keys(current.policies).length, Object.keys(expected).length, 'fixed policy count');
      Object.keys(expected).forEach(function (key) {
        var value = current.policies[key];
        if (!value) fail('missing policy ' + key);
        equal(value.limit, expected[key][0], key + ' limit');
        equal(value.windowSeconds, expected[key][1], key + ' window');
      });

      expectCode(function () {
        store.replaceRatePolicySet(dao, {
          expectedVersion: current.version,
          policies: [{ key: 'account_mail_email', limit: 0, windowSeconds: 900 }],
          actorId: 'fixture', now: new Date(),
        });
      }, 'POLICY_OUT_OF_SAFE_RANGE');
      expectCode(function () {
        store.replaceRatePolicySet(dao, {
          expectedVersion: current.version,
          policies: [{ key: 'custom_expression', limit: 1, windowSeconds: 60 }],
          actorId: 'fixture', now: new Date(),
        });
      }, 'POLICY_OUT_OF_SAFE_RANGE');
      expectCode(function () {
        store.replaceRatePolicySet(dao, {
          expectedVersion: current.version + 1,
          policies: current.policies,
          actorId: 'fixture', now: new Date(),
        });
      }, 'POLICY_VERSION_CONFLICT');

      var updateInput = {};
      Object.keys(current.policies).forEach(function (key) {
        updateInput[key] = {
          limit: current.policies[key].limit,
          windowSeconds: current.policies[key].windowSeconds,
        };
      });
      var updated;
      $app.dao().runInTransaction(function (txDao) {
        updated = store.replaceRatePolicySet(txDao, {
          expectedVersion: current.version,
          policies: updateInput,
          actorId: 'fixture_actor',
          now: new Date(),
        });
      });
      equal(updated.version, current.version + 1, 'CAS version increment');
      equal(store.getRatePolicySet(dao).version, updated.version, 'persisted CAS version');

      return c.json(200, { ok: true, policies: Object.keys(expected).length, version: updated.version });
    } catch (error) {
      return c.json(500, {
        ok: false,
        error: String(error && error.message ? error.message : error),
      });
    }
});
