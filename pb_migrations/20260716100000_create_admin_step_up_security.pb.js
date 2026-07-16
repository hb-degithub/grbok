/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const usersId = dao.findCollectionByNameOrId('users').id;

  function addField(collection, field) {
    collection.schema.addField(new SchemaField(field));
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const stepUpSessions = new Collection({
    name: 'admin_step_up_sessions',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(stepUpSessions, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  addField(stepUpSessions, { name: 'selector', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(stepUpSessions, { name: 'secret_hmac', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(stepUpSessions, { name: 'client_session_hmac', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(stepUpSessions, { name: 'fingerprint_hash', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(stepUpSessions, { name: 'ip_hash', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(stepUpSessions, { name: 'user_agent_hash', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(stepUpSessions, { name: 'verified_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(stepUpSessions, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(stepUpSessions, { name: 'revoked_at', type: 'date', required: false, options: { min: '', max: '' } });
  stepUpSessions.listRule = null;
  stepUpSessions.viewRule = null;
  stepUpSessions.createRule = null;
  stepUpSessions.updateRule = null;
  stepUpSessions.deleteRule = null;
  stepUpSessions.indexes = [
    'CREATE UNIQUE INDEX idx_admin_step_up_sessions_selector ON admin_step_up_sessions (selector)',
    'CREATE INDEX idx_admin_step_up_sessions_user_client ON admin_step_up_sessions (user, client_session_hmac, expires_at)',
    'CREATE INDEX idx_admin_step_up_sessions_expires ON admin_step_up_sessions (expires_at)',
  ];
  dao.saveCollection(stepUpSessions);

  const passkeyState = new Collection({
    name: 'admin_passkey_state',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(passkeyState, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  addField(passkeyState, { name: 'bootstrapped_at', type: 'date', required: true, options: { min: '', max: '' } });
  passkeyState.listRule = null;
  passkeyState.viewRule = null;
  passkeyState.createRule = null;
  passkeyState.updateRule = null;
  passkeyState.deleteRule = null;
  passkeyState.indexes = [
    'CREATE UNIQUE INDEX idx_admin_passkey_state_user ON admin_passkey_state (user)',
  ];
  dao.saveCollection(passkeyState);

  const securityAudits = new Collection({
    name: 'admin_security_audits',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(securityAudits, { name: 'actor', type: 'relation', required: false, options: { collectionId: usersId, cascadeDelete: false, maxSelect: 1 } });
  addField(securityAudits, { name: 'action_code', type: 'text', required: true, options: { min: 1, max: 100, pattern: '^[A-Z0-9_]+$' } });
  addField(securityAudits, { name: 'target_type', type: 'text', required: true, options: { min: 1, max: 100, pattern: '^[a-z0-9_]+$' } });
  addField(securityAudits, { name: 'target_id', type: 'text', required: false, options: { min: null, max: 255, pattern: '' } });
  addField(securityAudits, { name: 'before_json', type: 'json', required: false, options: { maxSize: 16384 } });
  addField(securityAudits, { name: 'after_json', type: 'json', required: false, options: { maxSize: 16384 } });
  addField(securityAudits, { name: 'version', type: 'number', required: true, options: { min: 1, max: null, noDecimal: true } });
  addField(securityAudits, { name: 'reference_id', type: 'text', required: true, options: { min: 1, max: 128, pattern: '^[A-Za-z0-9_-]+$' } });
  addField(securityAudits, { name: 'priority', type: 'select', required: true, options: { values: ['normal', 'high'], maxSelect: 1 } });
  securityAudits.listRule = null;
  securityAudits.viewRule = null;
  securityAudits.createRule = null;
  securityAudits.updateRule = null;
  securityAudits.deleteRule = null;
  securityAudits.indexes = [
    'CREATE INDEX idx_admin_security_audits_reference ON admin_security_audits (reference_id)',
    'CREATE INDEX idx_admin_security_audits_action_created ON admin_security_audits (action_code, created)',
  ];
  dao.saveCollection(securityAudits);

  const challenges = dao.findCollectionByNameOrId('webauthn_challenges');
  const activeChallenges = dao.findRecordsByFilter('webauthn_challenges', 'id != ""', '+created', 5000, 0);
  for (const challenge of activeChallenges) dao.deleteRecord(challenge);
  ensureField(challenges, {
    name: 'purpose',
    type: 'select',
    required: true,
    options: { values: ['bootstrap_registration', 'add_registration', 'authentication'], maxSelect: 1 },
  });
  ensureField(challenges, { name: 'binding_selector', type: 'text', required: false, options: { min: null, max: 255, pattern: '' } });
  ensureField(challenges, { name: 'client_session_hmac', type: 'text', required: false, options: { min: null, max: 64, pattern: '^[a-f0-9]{64}$' } });
  challenges.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
    'CREATE INDEX idx_webauthn_challenges_user_purpose_expires ON webauthn_challenges (user, purpose, expires_at)',
  ];
  dao.saveCollection(challenges);

  const passkeys = dao.findCollectionByNameOrId('admin_passkeys');
  passkeys.listRule = null;
  passkeys.viewRule = null;
  passkeys.createRule = null;
  passkeys.updateRule = null;
  passkeys.deleteRule = null;
  dao.saveCollection(passkeys);

  const stateCollection = dao.findCollectionByNameOrId('admin_passkey_state');
  const historical = dao.findRecordsByFilter('admin_passkeys', 'owner != ""', '+created', 5000, 0);
  const seen = {};
  for (const passkey of historical) {
    const userId = passkey.get('owner');
    if (seen[userId]) continue;
    seen[userId] = true;
    const state = new Record(stateCollection);
    state.set('user', userId);
    state.set('bootstrapped_at', passkey.get('created') || new Date().toISOString());
    dao.saveRecord(state);
  }
}, (db) => {
  const dao = new Dao(db);

  for (const name of ['admin_security_audits', 'admin_passkey_state', 'admin_step_up_sessions']) {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (_) {}
  }

  try {
    const challenges = dao.findCollectionByNameOrId('webauthn_challenges');
    for (const name of ['binding_selector', 'client_session_hmac']) {
      try {
        const field = challenges.schema.getFieldByName(name);
        challenges.schema.removeField(field.id);
      } catch (_) {}
    }
    const purpose = challenges.schema.getFieldByName('purpose');
    challenges.schema.addField(new SchemaField({
      id: purpose.id,
      name: 'purpose',
      type: 'select',
      required: true,
      options: { values: ['registration', 'authentication'], maxSelect: 1 },
    }));
    challenges.indexes = [
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
      'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
    ];
    dao.saveCollection(challenges);
  } catch (_) {}

  try {
    const passkeys = dao.findCollectionByNameOrId('admin_passkeys');
    passkeys.listRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
    passkeys.viewRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
    passkeys.createRule = null;
    passkeys.updateRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
    passkeys.deleteRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
    dao.saveCollection(passkeys);
  } catch (_) {}
});
