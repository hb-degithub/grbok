(function () {
  /// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

  routerAdd('POST', '/api/test/mail-account/seed-request-limits', function (c) {
    try {
      const crypto = require(__hooks + '/lib/mail_crypto.js');
      const logs = require(__hooks + '/lib/mail_logs.js');
      const input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
      const count = Number(input.count);
      const scope = String(input.scope || '');
      const email = String(input.email || 'seed@example.com').trim().toLowerCase();
      const ip = String(input.ip || '127.0.0.1').trim();
      if (
        !Number.isInteger(count)
        || count < 0
        || count > 30
        || ['email', 'ip', 'global'].indexOf(scope) === -1
      ) {
        return c.json(400, { code: 'INVALID_FIXTURE_INPUT' });
      }

      for (let i = 0; i < count; i++) {
        const rowEmail = scope === 'email' ? email : 'seed' + i + '@example.com';
        const rowIp = scope === 'ip' ? ip : '198.51.100.' + ((i % 200) + 1);
        logs.delivery({
          request_id: 'fixture_limit_' + scope + '_' + Date.now() + '_' + i,
          category: [
            'account_password_reset',
            'account_verification',
            'account_email_change',
          ][i % 3],
          source_collection: 'account_request',
          source_record_id: 'fixture_seed',
          recipient_masked: crypto.maskEmail(rowEmail),
          recipient_hash: crypto.hashPrivate('email', rowEmail),
          request_ip_hash: crypto.hashPrivate('ip', rowIp),
          result: 'accepted',
          duration_ms: 0,
          attempt: 1,
          error_class: 'none',
        });
      }
      return c.json(200, { seeded: count, scope: scope });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
  routerAdd('GET', '/api/test/mail-account/request-log-summary', function (c) {
    try {
      const crypto = require(__hooks + '/lib/mail_crypto.js');
      const email = String(c.queryParam('email') || '').trim().toLowerCase();
      const hash = crypto.hashPrivate('email', email);
      const requestRecords = $app.dao().findRecordsByFilter(
        'mail_delivery_logs',
        'source_collection = {:source} && recipient_hash = {:hash}',
        'created',
        200,
        0,
        { source: 'account_request', hash: hash },
      );
      const deliveryRecords = $app.dao().findRecordsByFilter(
        'mail_delivery_logs',
        'source_collection = {:source} && recipient_hash = {:hash}',
        'created',
        200,
        0,
        { source: 'users', hash: hash },
      );
      function summarize(record) {
        return {
          category: record.getString('category'),
          result: record.getString('result'),
          sourceRecordId: record.getString('source_record_id'),
          recipientMasked: record.getString('recipient_masked'),
          errorClass: record.getString('error_class'),
        };
      }
      return c.json(200, {
        count: requestRecords.length,
        rows: requestRecords.map(summarize),
        deliveryCount: deliveryRecords.length,
        deliveries: deliveryRecords.map(summarize),
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
  routerAdd('POST', '/api/test/mail-account/setup-facade-users', function (c) {
    try {
      const users = $app.dao().findCollectionByNameOrId('users');
      const suffix = $security.randomStringWithAlphabet(
        10,
        'abcdefghijklmnopqrstuvwxyz0123456789',
      );

      function createAccount(label, verified, role) {
        const record = new Record(users);
        const email = label + '_' + suffix + '@example.com';
        record.set('email', email);
        record.set('username', label + '_' + suffix);
        record.set('password', 'Test12345!');
        record.set('passwordConfirm', 'Test12345!');
        record.set('name', label);
        record.set('role', role);
        record.set('verified', verified);
        record.refreshTokenKey();
        $app.dao().saveRecord(record);
        return {
          id: record.id,
          email: email,
          token: verified ? $tokens.recordAuthToken($app, record) : '',
        };
      }

      return c.json(200, {
        reader: createAccount('facade_reader', true, 'reader'),
        superAdmin: createAccount('facade_super', true, 'super_admin'),
        unverifiedReader: createAccount('facade_unverified_reader', false, 'reader'),
        unverifiedAdmin: createAccount('facade_unverified_admin', false, 'admin'),
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
  routerAdd('POST', '/internal/mail/send', function (c) {
    try {
      const raw = readerToString(c.request().body, 262144);
      const message = JSON.parse(raw || '{}');
      const expectedPath = {
        account_verification: '/verify-email?token=',
        account_password_reset: '/reset-password?token=',
        account_email_change: '/confirm-email-change?token=',
      }[message.category];
      const combined = String(message.html || '') + '\n' + String(message.text || '');
      if (
        !expectedPath
        || combined.indexOf(expectedPath) === -1
        || !/^req_[A-Za-z0-9_-]{20,}$/.test(String(message.requestId || ''))
        || !/^msg_[A-Za-z0-9_-]{20,}$/.test(String(message.messageId || ''))
      ) {
        return c.json(422, {
          ok: false,
          error: { code: 'PAYLOAD_INVALID', retryable: false },
        });
      }
      return c.json(202, { ok: true, requestId: message.requestId });
    } catch (_) {
      return c.json(422, {
        ok: false,
        error: { code: 'PAYLOAD_INVALID', retryable: false },
      });
    }
  });

  routerAdd('GET', '/api/test/mail-account/crypto', function (e) {
    try {
      let crypto;
      try {
        crypto = require(__hooks + '/lib/mail_crypto.js');
      } catch (loadError) {
        throw new Error('mail_crypto load failed: ' + String(
          loadError && loadError.message ? loadError.message : loadError,
        ));
      }
      const signature = crypto.sign(
        'POST',
        '/internal/mail/send',
        '{}',
        '1720828800',
        'nonce-123',
      );
      let nonStringRejected = false;
      try {
        crypto.equal('same', 1);
      } catch (_) {
        nonStringRejected = true;
      }
      return e.json(200, {
        idShape: /^acct_[A-Za-z0-9_-]{20,}$/.test(crypto.requestId('acct')),
        masked: crypto.maskEmail('reader@example.com'),
        singleMasked: crypto.maskEmail('r@example.com'),
        invalidMasked: crypto.maskEmail('invalid@@example.com'),
        invalidLeadingDot: crypto.maskEmail('.reader@example.com'),
        invalidDoubleDot: crypto.maskEmail('read..er@example.com'),
        equalTrue: crypto.equal('same', 'same'),
        equalFalse: crypto.equal('same', 'different'),
        nonStringRejected: nonStringRejected,
        hashLength: crypto.hashPrivate('email', 'reader@example.com').length,
        signatureLength: signature.length,
      });
    } catch (error) {
      return e.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('GET', '/api/test/mail-account/gateway', function (c) {
    try {
      let gateway;
      try {
        gateway = require(__hooks + '/lib/mail_gateway.js');
      } catch (loadError) {
        throw new Error('mail_gateway load failed: ' + String(
          loadError && loadError.message ? loadError.message : loadError,
        ));
      }

      const scenario = c.queryParam('case') || 'success';
      if (scenario === 'status') {
        return c.json(200, { scenario: scenario, result: gateway.status() });
      }

      try {
        const message = {
          requestId: 'gateway-' + scenario,
          messageId: 'gateway-' + scenario,
          category: 'admin_test',
          to: 'reader@example.com',
          subject: 'Gateway probe',
          html: '<p>Gateway probe</p>',
          text: 'Gateway probe',
        };
        if (scenario === 'circular') message.circular = message;
        const result = gateway.send(message);
        return c.json(200, { scenario: scenario, result: result });
      } catch (error) {
        return c.json(200, {
          scenario: scenario,
          error: {
            name: error.name,
            code: error.code,
            retryable: error.retryable,
            statusCode: error.statusCode,
            enumerableKeys: Object.keys(error).sort(),
          },
        });
      }
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
  routerAdd('GET', '/api/test/mail-account/render-log', function (c) {
    try {
      let templates;
      let logs;
      try {
        templates = require(__hooks + '/lib/mail_templates.js');
        logs = require(__hooks + '/lib/mail_logs.js');
      } catch (loadError) {
        throw new Error('render-log module load failed: ' + String(
          loadError && loadError.message ? loadError.message : loadError,
        ));
      }

      const rendered = templates.render('reader_otp', {
        displayName: '<Reader>',
        code: '123456',
        expiresMinutes: '10',
      });
      if (rendered.html.indexOf('&lt;Reader&gt;') === -1) {
        throw new Error('display name was not escaped');
      }
      if (rendered.html.indexOf('<Reader>') !== -1) throw new Error('raw HTML leaked');
      if (rendered.text.indexOf('123456') === -1) throw new Error('text alternative missing code');
      if (rendered.subject !== '\u4f60\u7684\u767b\u5f55\u9a8c\u8bc1\u7801') {
        throw new Error('subject mismatch');
      }

      logs.delivery({
        request_id: 'fixture_log_1',
        category: 'reader_otp',
        source_collection: 'users',
        source_record_id: 'fixture_reader',
        recipient_masked: 'r****r@example.com',
        recipient_hash: 'recipient_hash_fixture',
        request_ip_hash: 'request_ip_hash_fixture',
        result: 'sent',
        duration_ms: 200000,
        attempt: 101,
        error_class: 'none',
      });
      const saved = $app.dao().findFirstRecordByData(
        'mail_delivery_logs',
        'request_id',
        'fixture_log_1',
      );
      for (const forbidden of ['html', 'text', 'body', 'token', 'code', 'recipient']) {
        if (saved.get(forbidden)) throw new Error('forbidden log field: ' + forbidden);
      }
      if (saved.getInt('duration_ms') !== 120000) throw new Error('duration clamp failed');
      if (saved.getInt('attempt') !== 100) throw new Error('attempt clamp failed');
      const count = logs.rateCount(
        'recipient_hash',
        'recipient_hash_fixture',
        '2000-01-01 00:00:00.000Z',
      );
      if (count !== 1) throw new Error('rate count mismatch');

      return c.json(200, {
        category: rendered.category,
        version: rendered.version,
        subject: rendered.subject,
        escaped: true,
        bodyFree: true,
        rateCount: count,
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
    routerAdd('GET', '/api/test/mail-account/account-mail', function (c) {
    try {
      var facade = require(__hooks + '/lib/auth_facade.js');
      var crypto = require(__hooks + '/lib/mail_crypto.js');
      var logs = require(__hooks + '/lib/mail_logs.js');

      // Create a test user record
      var usersCollection = $app.dao().findCollectionByNameOrId('users');
      var testEmail = 'test_account_' + Date.now() + '@example.com';
      var user = new Record(usersCollection);
      user.set('email', testEmail);
      user.set('name', 'TestReader');
      user.set('username', 'test_' + Date.now());
      user.set('password', 'Test12345!');
      user.set('passwordConfirm', 'Test12345!');
      user.set('verified', false);
      user.set('role', 'reader');
      $app.dao().saveRecord(user);

      // Simulate a Mailer Before event
      var fakeToken = 'tok_' + $security.randomStringWithAlphabet(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
      var fakeEvent = {
        record: user,
        message: {
          from: { address: 'noreply@hlydwz.com', name: 'hlydwz' },
          to: [{ address: testEmail }],
          subject: 'test',
          html: '<p>test</p>',
          text: 'test',
          headers: {},
          attachments: {},
        },
        meta: { token: fakeToken },
      };

      var gatewayEnabled = String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true';
      var accountEnabled = String($os.getenv('MAIL_ACCOUNT_ENABLED') || '').trim().toLowerCase() === 'true';

      var errorCaught = null;
      if (gatewayEnabled && accountEnabled) {
        try {
          facade.forwardAccountMail('account_verification', fakeEvent);
        } catch (err) {
          errorCaught = String(err && err.message ? err.message : err);
        }
      } else {
        facade.forwardAccountMail('account_verification', fakeEvent);
      }

      // Verify the token does NOT appear in mail_delivery_logs
      var allLogs = $app.dao().findRecordsByFilter(
        'mail_delivery_logs',
        'request_id != ""',
        '-created',
        1000,
        0,
        {}
      );

      var tokenInLogs = false;
      for (var i = 0; i < allLogs.length; i++) {
        var row = allLogs[i];
        var rowStr = JSON.stringify({
          request_id: row.getString('request_id'),
          category: row.getString('category'),
          recipient_masked: row.getString('recipient_masked'),
          error_class: row.getString('error_class'),
        });
        if (rowStr.indexOf(fakeToken) !== -1) tokenInLogs = true;
      }

      // Clean up test user
      try { $app.dao().deleteRecord(user); } catch (_) {}

      return c.json(200, {
        featureEnabled: gatewayEnabled && accountEnabled,
        errorCaught: errorCaught,
        tokenLeakedToLogs: tokenInLogs,
        logCount: allLogs.length,
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
routerAdd('GET', '/api/mail-local/account-foundation', (c) => {
    function assertPrivate(collection, name) {
      if (
        collection.listRule !== null
        || collection.viewRule !== null
        || collection.createRule !== null
        || collection.updateRule !== null
        || collection.deleteRule !== null
      ) {
        throw new Error(name + ' must be private');
      }
    }

    function assertAccountFoundation() {
      const expected = {
        mail_templates: [
          'key', 'name', 'category', 'version', 'is_current',
          'subject_template', 'content_json', 'variables_json',
          'required_variables_json', 'builtin',
        ],
        mail_delivery_logs: [
          'request_id', 'category', 'source_collection', 'source_record_id',
          'recipient_masked', 'recipient_hash', 'request_ip_hash', 'result',
          'duration_ms', 'attempt', 'error_class',
        ],
        auth_otp_challenges: [
          'challenge_id', 'user', 'email_hash', 'ip_hash', 'code_hash',
          'expires_at', 'attempts', 'consumed_at',
        ],
      };

      for (const name of Object.keys(expected)) {
        let collection;
        try {
          collection = $app.dao().findCollectionByNameOrId(name);
        } catch (_) {
          throw new Error('missing collection ' + name);
        }
        assertPrivate(collection, name);
        const fields = collection.schema.fields().map((field) => field.name);
        for (const field of expected[name]) {
          if (fields.indexOf(field) === -1) throw new Error(name + ' missing ' + field);
        }
      }

      const templates = $app.dao().findRecordsByFilter(
        'mail_templates',
        'is_current = true',
        'key',
        20,
        0,
      );
      const keys = templates.map((record) => record.getString('key')).sort();
      const wanted = [
        'account_email_change',
        'account_password_reset',
        'account_verification',
        'reader_otp',
      ];
      if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
        throw new Error('unexpected template keys: ' + JSON.stringify(keys));
      }

      return { schema: 'ok', templates: templates.length };
    }

    try {
      return c.json(200, assertAccountFoundation());
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
  routerAdd('GET', '/api/test/mail-account/account-facade-parity', function (c) {
    try {
      const crypto = require(__hooks + '/lib/mail_crypto.js');
      const base = 'http://127.0.0.1:8090';
      const setup = $http.send({
        url: base + '/api/test/mail-account/setup-facade-users',
        method: 'POST',
        timeout: 5,
      });
      if (setup.statusCode !== 200 || !setup.json) {
        throw new Error('facade account setup failed');
      }

      const accounts = setup.json;
      const suffix = $security.randomStringWithAlphabet(
        10,
        'abcdefghijklmnopqrstuvwxyz0123456789',
      );
      const resetPath = '/api/blog-auth/password-reset/request';
      const verificationPath = '/api/blog-auth/verification/request';
      const changePath = '/api/blog-auth/email-change/request';
      const cases = [
        {
          label: 'password-reader',
          path: resetPath,
          field: 'email',
          email: accounts.reader.email,
          sourceId: accounts.reader.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
        },
        {
          label: 'password-super-admin',
          path: resetPath,
          field: 'email',
          email: accounts.superAdmin.email,
          sourceId: accounts.superAdmin.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
        },
        {
          label: 'password-unknown',
          path: resetPath,
          field: 'email',
          email: 'facade_unknown_reset_' + suffix + '@example.com',
          sourceId: 'decoy',
          expectedResult: 'decoy',
          shouldDeliver: false,
        },
        {
          label: 'verification-reader',
          path: verificationPath,
          field: 'email',
          email: accounts.unverifiedReader.email,
          sourceId: accounts.unverifiedReader.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
        },
        {
          label: 'verification-admin',
          path: verificationPath,
          field: 'email',
          email: accounts.unverifiedAdmin.email,
          sourceId: accounts.unverifiedAdmin.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
        },
        {
          label: 'verification-verified',
          path: verificationPath,
          field: 'email',
          email: accounts.reader.email,
          sourceId: accounts.reader.id,
          expectedResult: 'decoy',
          shouldDeliver: false,
        },
        {
          label: 'verification-unknown',
          path: verificationPath,
          field: 'email',
          email: 'facade_unknown_verify_' + suffix + '@example.com',
          sourceId: 'decoy',
          expectedResult: 'decoy',
          shouldDeliver: false,
        },
        {
          label: 'email-change-reader',
          path: changePath,
          field: 'newEmail',
          email: 'facade_change_reader_' + suffix + '@example.com',
          sourceId: accounts.reader.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
          token: accounts.reader.token,
        },
        {
          label: 'email-change-super-admin',
          path: changePath,
          field: 'newEmail',
          email: 'facade_change_super_' + suffix + '@example.com',
          sourceId: accounts.superAdmin.id,
          expectedResult: 'accepted',
          shouldDeliver: true,
          token: accounts.superAdmin.token,
        },
        {
          label: 'email-change-unauthenticated',
          path: changePath,
          field: 'newEmail',
          email: 'facade_change_unauth_' + suffix + '@example.com',
          sourceId: 'decoy',
          expectedResult: 'decoy',
          shouldDeliver: false,
        },
      ];

      function utf8ByteLength(value) {
        let length = 0;
        for (let i = 0; i < value.length; i++) {
          const code = value.charCodeAt(i);
          if (code <= 0x7f) length += 1;
          else if (code <= 0x7ff) length += 2;
          else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
            const next = value.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
              length += 4;
              i++;
            } else length += 3;
          } else length += 3;
        }
        return length;
      }

      const expectedMessage = '\u5982\u679c\u8be5\u8d26\u6237\u53ef\u7528\uff0c\u6211\u4eec\u4f1a\u53d1\u9001\u90ae\u4ef6\u3002';
      let canonicalRaw = '';
      const observed = [];

      for (let i = 0; i < cases.length; i++) {
        const item = cases[i];
        const headers = {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.' + (i + 1),
        };
        if (item.token) headers.Authorization = item.token;
        const body = {};
        body[item.field] = item.email;

        const startedAt = Date.now();
        const response = $http.send({
          url: base + item.path,
          method: 'POST',
          body: JSON.stringify(body),
          headers: headers,
          timeout: 10,
        });
        const elapsedMs = Date.now() - startedAt;
        const raw = String(response.raw || '');
        const parsed = JSON.parse(raw || '{}');
        const keys = Object.keys(parsed).sort().join(',');

        if (
          response.statusCode !== 202
          || keys !== 'accepted,message'
          || parsed.accepted !== true
          || parsed.message !== expectedMessage
          || elapsedMs < 330
        ) {
          throw new Error(
            item.label
            + ' parity failed: status=' + response.statusCode
            + ' keys=' + keys
            + ' elapsed=' + elapsedMs,
          );
        }
        if (!canonicalRaw) canonicalRaw = raw;
        if (raw !== canonicalRaw) {
          throw new Error(item.label + ' response bytes differ');
        }

        const hash = crypto.hashPrivate('email', item.email);
        const requestRows = $app.dao().findRecordsByFilter(
          'mail_delivery_logs',
          'source_collection = {:source} && category = {:category} && recipient_hash = {:hash}',
          '-created',
          10,
          0,
          {
            source: 'account_request',
            category: item.path === resetPath
              ? 'account_password_reset'
              : item.path === verificationPath
                ? 'account_verification'
                : 'account_email_change',
            hash: hash,
          },
        );
        if (
          requestRows.length !== 1
          || requestRows[0].getString('result') !== item.expectedResult
          || requestRows[0].getString('source_record_id') !== item.sourceId
        ) {
          throw new Error(item.label + ' request log mismatch');
        }

        const deliveryRows = $app.dao().findRecordsByFilter(
          'mail_delivery_logs',
          'source_collection = {:source} && category = {:category} && recipient_hash = {:hash}',
          '-created',
          10,
          0,
          {
            source: 'users',
            category: requestRows[0].getString('category'),
            hash: hash,
          },
        );
        if (
          item.shouldDeliver
            ? deliveryRows.length !== 1
              || deliveryRows[0].getString('result') !== 'sent'
              || deliveryRows[0].getString('source_record_id') !== item.sourceId
            : deliveryRows.length !== 0
        ) {
          throw new Error(item.label + ' delivery log mismatch');
        }

        observed.push({
          label: item.label,
          status: response.statusCode,
          elapsedMs: elapsedMs,
          bodyBytes: utf8ByteLength(raw),
          result: item.expectedResult,
          deliveries: deliveryRows.length,
        });
      }

      const canonicalBytes = utf8ByteLength(canonicalRaw);
      if (canonicalBytes !== 79) {
        throw new Error('unexpected accepted response byte length: ' + canonicalBytes);
      }
      return c.json(200, {
        cases: observed,
        canonicalBytes: canonicalBytes,
      });
    } catch (error) {
      return c.json(500, {
        error: String(error && error.message ? error.message : error),
      });
    }
  });

  routerAdd('GET', '/api/test/mail-account/account-facade-red', function (c) {
    var routes = [
      ['/api/blog-auth/password-reset/request', { email: 'unknown@example.com' }],
      ['/api/blog-auth/verification/request', { email: 'unknown@example.com' }],
      ['/api/blog-auth/email-change/request', { newEmail: 'unknown@example.com' }],
    ];
    var observed = [];
    for (var i = 0; i < routes.length; i++) {
      var response = $http.send({
        url: 'http://127.0.0.1:8090' + routes[i][0],
        method: 'POST',
        body: JSON.stringify(routes[i][1]),
        headers: { 'Content-Type': 'application/json' },
        timeout: 5,
      });
      observed.push({ path: routes[i][0], status: response.statusCode, body: response.raw });
      if (response.statusCode !== 202) {
        return c.json(500, { expected: 202, observed: observed });
      }
    }
    return c.json(200, { routes: observed });
  });

  routerAdd('POST', '/api/test/mail-account/setup-otp-users', function (c) {
    try {
      var collection = $app.dao().findCollectionByNameOrId('users');
      function createAccount(email, verified, role) {
        var existing = $app.dao().findRecordsByFilter(
          'users', 'email = {:email}', '', 1, 0, { email: email }
        );
        if (existing && existing.length) return existing[0];
        var record = new Record(collection);
        record.set('email', email);
        record.set('username', email.split('@')[0].replace(/[^a-z0-9]/g, '_'));
        record.set('password', 'Test12345!');
        record.set('passwordConfirm', 'Test12345!');
        record.set('name', email.split('@')[0]);
        record.set('role', role);
        record.set('verified', verified);
        record.refreshTokenKey();
        $app.dao().saveRecord(record);
        return record;
      }
      var accounts = {
        reader: createAccount('reader@example.local', true, 'reader'),
        unverified: createAccount('unverified@example.local', false, 'reader'),
        admin: createAccount('admin@example.local', true, 'admin'),
        superAdmin: createAccount('super@example.local', true, 'super_admin'),
        author: createAccount('author@example.local', true, 'author'),
      };
      return c.json(200, {
        reader: { id: accounts.reader.id, email: accounts.reader.getString('email') },
        unverified: { id: accounts.unverified.id, email: accounts.unverified.getString('email') },
        admin: { id: accounts.admin.id, email: accounts.admin.getString('email') },
        superAdmin: { id: accounts.superAdmin.id, email: accounts.superAdmin.getString('email') },
        author: { id: accounts.author.id, email: accounts.author.getString('email') },
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('POST', '/api/test/mail-account/reset-otp-challenges', function (c) {
    try {
      while (true) {
        var rows = $app.dao().findRecordsByFilter(
          'auth_otp_challenges', 'challenge_id != ""', 'created', 500, 0, {}
        );
        for (var i = 0; i < rows.length; i++) $app.dao().deleteRecord(rows[i]);
        if (rows.length < 500) break;
      }
      return c.json(200, { reset: true });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('POST', '/api/test/mail-account/seed-otp-limits', function (c) {
    try {
      var input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
      var scope = String(input.scope || '');
      var count = Number(input.count);
      var email = String(input.email || 'reader@example.local').trim().toLowerCase();
      var ip = String(input.ip || '127.0.0.1').trim();
      if (
        ['email', 'ip', 'global'].indexOf(scope) === -1
        || !Number.isInteger(count)
        || count < 0
        || count > 30
      ) {
        return c.json(400, { code: 'INVALID_FIXTURE_INPUT' });
      }
      var crypto = require(__hooks + '/lib/mail_crypto.js');
      var collection = $app.dao().findCollectionByNameOrId('auth_otp_challenges');
      var secret = String($os.getenv('MAIL_HASH_SECRET') || '');
      for (var i = 0; i < count; i++) {
        var challengeId = 'fixture_' + scope + '_' + $security.randomStringWithAlphabet(
          24,
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'
        );
        var rowEmail = scope === 'email' ? email : 'seed' + i + '@example.local';
        var rowIp = scope === 'ip' ? ip : '198.51.100.' + ((i % 200) + 1);
        var code = String(100000 + i).slice(-6);
        var record = new Record(collection);
        record.set('challenge_id', challengeId);
        record.set('user', '');
        record.set('email_hash', crypto.hashPrivate('email', rowEmail));
        record.set('ip_hash', crypto.hashPrivate('ip', rowIp));
        record.set('code_hash', $security.hs256('otp-code:' + challengeId + ':' + code, secret));
        record.set('expires_at', new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' '));
        record.set('attempts', 0);
        record.set('consumed_at', '');
        $app.dao().saveRecord(record);
      }
      return c.json(200, { seeded: count, scope: scope });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('POST', '/api/test/mail-account/expire-otp-challenge', function (c) {
    try {
      var input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
      var rows = $app.dao().findRecordsByFilter(
        'auth_otp_challenges',
        'challenge_id = {:challengeId}',
        '',
        1,
        0,
        { challengeId: String(input.challengeId || '') }
      );
      var record = rows && rows.length ? rows[0] : null;
      if (!record) return c.json(404, { code: 'NOT_FOUND' });
      record.set('expires_at', new Date(Date.now() - 60 * 1000).toISOString().replace('T', ' '));
      $app.dao().saveRecord(record);
      return c.json(200, { expired: true });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('GET', '/api/test/mail-account/otp-challenge-state', function (c) {
    try {
      var found = $app.dao().findRecordsByFilter(
        'auth_otp_challenges',
        'challenge_id = {:challengeId}',
        '',
        1,
        0,
        { challengeId: String(c.queryParam('challengeId') || '') }
      );
      var record = found && found.length ? found[0] : null;
      if (!record) return c.json(404, { code: 'NOT_FOUND' });
      var userId = record.getString('user');
      var activeForUser = 0;
      if (userId) {
        var rows = $app.dao().findRecordsByFilter(
          'auth_otp_challenges',
          'user = {:user}',
          '-created',
          1000,
          0,
          { user: userId }
        );
        for (var i = 0; i < rows.length; i++) {
          if (!rows[i].getString('consumed_at')) activeForUser += 1;
        }
      }
      return c.json(200, {
        attempts: record.getInt('attempts'),
        user: userId,
        consumed: Boolean(record.getString('consumed_at')),
        activeForUser: activeForUser,
        codeHash: record.getString('code_hash'),
      });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('GET', '/api/test/mail-account/otp-storage-scan', function (c) {
    try {
      var needle = String(c.queryParam('needle') || '');
      if (!needle) return c.json(400, { code: 'INVALID_FIXTURE_INPUT' });
      var challengeMatches = 0;
      var logMatches = 0;
      var challenges = $app.dao().findRecordsByFilter(
        'auth_otp_challenges', 'challenge_id != ""', '-created', 1000, 0, {}
      );
      var logs = $app.dao().findRecordsByFilter(
        'mail_delivery_logs', 'request_id != ""', '-created', 1000, 0, {}
      );
      for (var i = 0; i < challenges.length; i++) {
        var challengeText = JSON.stringify({
          challenge_id: challenges[i].getString('challenge_id'),
          user: challenges[i].getString('user'),
          email_hash: challenges[i].getString('email_hash'),
          ip_hash: challenges[i].getString('ip_hash'),
          code_hash: challenges[i].getString('code_hash'),
          expires_at: challenges[i].getString('expires_at'),
          attempts: challenges[i].getInt('attempts'),
          consumed_at: challenges[i].getString('consumed_at'),
        });
        if (challengeText.indexOf(needle) !== -1) challengeMatches += 1;
      }
      for (var j = 0; j < logs.length; j++) {
        var logText = JSON.stringify({
          request_id: logs[j].getString('request_id'),
          category: logs[j].getString('category'),
          source_collection: logs[j].getString('source_collection'),
          source_record_id: logs[j].getString('source_record_id'),
          recipient_masked: logs[j].getString('recipient_masked'),
          recipient_hash: logs[j].getString('recipient_hash'),
          request_ip_hash: logs[j].getString('request_ip_hash'),
          result: logs[j].getString('result'),
          error_class: logs[j].getString('error_class'),
        });
        if (logText.indexOf(needle) !== -1) logMatches += 1;
      }
      return c.json(200, { challengeMatches: challengeMatches, logMatches: logMatches });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });

  routerAdd('GET', '/api/test/mail-account/otp-red', function (c) {
    try {
      var request = $http.send({
        url: 'http://127.0.0.1:8090/api/blog-auth/otp/request',
        method: 'POST',
        body: JSON.stringify({ email: 'unknown@example.local' }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 10,
      });
      var verify = $http.send({
        url: 'http://127.0.0.1:8090/api/blog-auth/otp/verify',
        method: 'POST',
        body: JSON.stringify({
          challengeId: 'fixture_missing_challenge_0001',
          code: '123456',
        }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 10,
      });
      if (request.statusCode !== 202 || verify.statusCode !== 400) {
        throw new Error(
          'OTP routes unavailable: request=' + request.statusCode
          + ' verify=' + verify.statusCode
        );
      }
      return c.json(200, { request: 202, verify: 400 });
    } catch (error) {
      return c.json(500, { error: String(error && error.message ? error.message : error) });
    }
  });
})();
