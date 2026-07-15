(function () {
  /// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

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
})();
