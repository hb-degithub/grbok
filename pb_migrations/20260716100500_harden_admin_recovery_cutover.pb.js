/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const pageSize = 100;

  function deleteAllPages(collection) {
    while (true) {
      const page = dao.findRecordsByFilter(collection, 'id != ""', '+id', pageSize, 0);
      if (!page.length) return;
      for (const record of page) dao.deleteRecord(record);
    }
  }

  const state = dao.findCollectionByNameOrId('admin_passkey_state');
  state.schema.addField(new SchemaField({
    name: 'recovery_nonce_hmac',
    type: 'text',
    required: false,
    options: { min: null, max: 64, pattern: '^[a-f0-9]{64}$' },
  }));
  state.schema.addField(new SchemaField({
    name: 'recovery_expires_at',
    type: 'date',
    required: false,
    options: { min: '', max: '' },
  }));
  dao.saveCollection(state);

  const challenges = dao.findCollectionByNameOrId('webauthn_challenges');
  deleteAllPages('webauthn_challenges');
  const purpose = challenges.schema.getFieldByName('purpose');
  challenges.schema.addField(new SchemaField({
    id: purpose.id,
    name: 'purpose',
    type: 'select',
    required: true,
    options: { values: ['bootstrap_registration', 'add_registration', 'recovery_registration', 'authentication'], maxSelect: 1 },
  }));
  challenges.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
    'CREATE UNIQUE INDEX idx_webauthn_challenges_user_purpose ON webauthn_challenges (user, purpose)',
  ];
  dao.saveCollection(challenges);

  deleteAllPages('admin_verified_sessions');
}, (db) => {
  const dao = new Dao(db);

  try {
    const state = dao.findCollectionByNameOrId('admin_passkey_state');
    for (const name of ['recovery_nonce_hmac', 'recovery_expires_at']) {
      try {
        const field = state.schema.getFieldByName(name);
        state.schema.removeField(field.id);
      } catch (_) {}
    }
    dao.saveCollection(state);
  } catch (_) {}

  try {
    const challenges = dao.findCollectionByNameOrId('webauthn_challenges');
    const purpose = challenges.schema.getFieldByName('purpose');
    challenges.schema.addField(new SchemaField({
      id: purpose.id,
      name: 'purpose',
      type: 'select',
      required: true,
      options: { values: ['bootstrap_registration', 'add_registration', 'authentication'], maxSelect: 1 },
    }));
    challenges.indexes = [
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
      'CREATE INDEX idx_webauthn_challenges_user_purpose_expires ON webauthn_challenges (user, purpose, expires_at)',
    ];
    dao.saveCollection(challenges);
  } catch (_) {}
});
