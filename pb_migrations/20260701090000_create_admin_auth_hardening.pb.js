migrate((db) => {
  const dao = new Dao(db);

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function save(collection) {
    dao.saveCollection(collection);
    return dao.findCollectionByNameOrId(collection.name);
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const usersId = dao.findCollectionByNameOrId('users').id;

  // Admin passkeys
  let passkeys = find('admin_passkeys');
  if (!passkeys) {
    passkeys = new Collection({ name: 'admin_passkeys', type: 'base', system: false, schema: [] });
  }
  ensureField(passkeys, { name: 'owner', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  ensureField(passkeys, { name: 'label', type: 'text', required: false, options: { min: null, max: 255, pattern: '' } });
  ensureField(passkeys, { name: 'credential_id', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(passkeys, { name: 'public_key', type: 'text', required: true, options: { min: null, max: null, pattern: '' } });
  ensureField(passkeys, { name: 'counter', type: 'number', required: false, options: { min: 0, max: null } });
  ensureField(passkeys, { name: 'revoked_at', type: 'date', required: false, options: { min: '', max: '' } });
  passkeys.listRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
  passkeys.viewRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
  passkeys.createRule = null;
  passkeys.updateRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
  passkeys.deleteRule = '@request.auth.id = owner || @request.auth.role = "super_admin"';
  passkeys.indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_passkeys_credential_id ON admin_passkeys(credential_id)',
    'CREATE INDEX IF NOT EXISTS idx_admin_passkeys_owner ON admin_passkeys(owner)',
  ];
  save(passkeys);

  // WebAuthn challenges (single-use server-side state)
  let challenges = find('webauthn_challenges');
  if (!challenges) {
    challenges = new Collection({ name: 'webauthn_challenges', type: 'base', system: false, schema: [] });
  }
  ensureField(challenges, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  ensureField(challenges, { name: 'challenge', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(challenges, { name: 'purpose', type: 'select', required: true, options: { values: ['registration', 'authentication'], maxSelect: 1 } });
  ensureField(challenges, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  challenges.listRule = null;
  challenges.viewRule = null;
  challenges.createRule = null;
  challenges.updateRule = null;
  challenges.deleteRule = null;
  challenges.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge)',
    'CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at)',
  ];
  save(challenges);

  // Verified admin sessions
  let sessions = find('admin_verified_sessions');
  if (!sessions) {
    sessions = new Collection({ name: 'admin_verified_sessions', type: 'base', system: false, schema: [] });
  }
  ensureField(sessions, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  ensureField(sessions, { name: 'token_hash', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(sessions, { name: 'fingerprint_hash', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(sessions, { name: 'ip_hash', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(sessions, { name: 'user_agent_hash', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(sessions, { name: 'verified_at', type: 'date', required: true, options: { min: '', max: '' } });
  ensureField(sessions, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  ensureField(sessions, { name: 'revoked_at', type: 'date', required: false, options: { min: '', max: '' } });
  sessions.listRule = null;
  sessions.viewRule = null;
  sessions.createRule = null;
  sessions.updateRule = null;
  sessions.deleteRule = null;
  sessions.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_admin_verified_sessions_user ON admin_verified_sessions(user)',
    'CREATE INDEX IF NOT EXISTS idx_admin_verified_sessions_expires ON admin_verified_sessions(expires_at)',
  ];
  save(sessions);

  // Recovery codes
  let codes = find('admin_recovery_codes');
  if (!codes) {
    codes = new Collection({ name: 'admin_recovery_codes', type: 'base', system: false, schema: [] });
  }
  ensureField(codes, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  ensureField(codes, { name: 'code_hash', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(codes, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  ensureField(codes, { name: 'used_at', type: 'date', required: false, options: { min: '', max: '' } });
  codes.listRule = null;
  codes.viewRule = null;
  codes.createRule = null;
  codes.updateRule = null;
  codes.deleteRule = null;
  codes.indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_recovery_codes_code_hash ON admin_recovery_codes(code_hash)',
    'CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_user ON admin_recovery_codes(user)',
  ];
  save(codes);
}, (db) => {
  const dao = new Dao(db);
  for (const name of ['admin_passkeys', 'webauthn_challenges', 'admin_verified_sessions', 'admin_recovery_codes']) {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
