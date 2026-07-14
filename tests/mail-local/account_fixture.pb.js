(function () {
  /// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

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
