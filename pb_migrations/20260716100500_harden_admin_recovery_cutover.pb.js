/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

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
  const pendingChallenges = dao.findRecordsByFilter('webauthn_challenges', 'id != ""', '+created', 5000, 0);
  for (const challenge of pendingChallenges) dao.deleteRecord(challenge);
  challenges.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
    'CREATE UNIQUE INDEX idx_webauthn_challenges_user_purpose ON webauthn_challenges (user, purpose)',
  ];
  dao.saveCollection(challenges);

  const legacySessions = dao.findRecordsByFilter('admin_verified_sessions', 'id != ""', '+created', 5000, 0);
  for (const session of legacySessions) dao.deleteRecord(session);
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
    challenges.indexes = [
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
      'CREATE INDEX idx_webauthn_challenges_user_purpose_expires ON webauthn_challenges (user, purpose, expires_at)',
    ];
    dao.saveCollection(challenges);
  } catch (_) {}
});
