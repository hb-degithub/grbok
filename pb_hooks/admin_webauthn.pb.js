const ADMIN_CAPABLE_ROLES = ['author', 'admin', 'super_admin'];
const SUPER_ADMIN_ROLE = 'super_admin';
const CHALLENGE_TTL_MINUTES = 5;

const INTERNAL_URL = ($os.getenv('ADMIN_AUTH_INTERNAL_URL') || '').trim() || 'http://admin-auth:8787';
const INTERNAL_SECRET = ($os.getenv('ADMIN_AUTH_INTERNAL_SECRET') || '').trim();
const HASH_SECRET = ($os.getenv('ADMIN_AUTH_HASH_SECRET') || '').trim();

function currentUser(c) {
  return c.get('authRecord') || null;
}

function roleOf(record) {
  if (!record) return '';
  return String(record.get('role') || '').trim();
}

function requireAdminCapable(c) {
  const user = currentUser(c);
  if (!user || ADMIN_CAPABLE_ROLES.indexOf(roleOf(user)) === -1) {
    throw new UnauthorizedError('Admin authentication required');
  }
  return user;
}

function requireSuperAdmin(c) {
  const user = currentUser(c);
  if (!user || roleOf(user) !== SUPER_ADMIN_ROLE) {
    throw new UnauthorizedError('Super admin authentication required');
  }
  return user;
}

function getClientIP(c) {
  const info = $apis.requestInfo(c);
  return (info.clientIp || 'unknown').trim();
}

function getHeader(c, name) {
  const info = $apis.requestInfo(c);
  const lower = name.toLowerCase();
  return info.headers[lower] || info.headers[name] || '';
}

function getAuthToken(c) {
  const auth = getHeader(c, 'Authorization');
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function hashForAudit(value) {
  try {
    return $security.sha256(value);
  } catch (_) {
    return value;
  }
}

function redactIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  return hashForAudit(ip).slice(0, 16);
}

function writeAuditLog({ userId, action, targetCollection, targetId, summary, ip }) {
  try {
    const collection = $app.dao().findCollectionByNameOrId('audit_logs');
    const record = new Record(collection);
    record.set('actor', userId || 'anonymous');
    record.set('action', action);
    record.set('target_collection', targetCollection || '');
    record.set('target_id', targetId || '');
    record.set('summary', summary || '');
    record.set('ip', redactIp(ip));
    $app.dao().saveRecord(record);
  } catch (err) {
    console.error('audit log error:', err);
  }
}

function postInternal(path, body) {
  const res = $http.send({
    url: INTERNAL_URL + path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
    timeout: 10000,
  });
  if (res.statusCode >= 400) {
    throw new Error(`admin-auth error ${res.statusCode}: ${res.raw}`);
  }
  try {
    return JSON.parse(res.raw);
  } catch (_) {
    return {};
  }
}

function randomChallenge() {
  return $security.randomString(32);
}

function challengeExpiresAt() {
  return new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000).toISOString();
}

function saveChallenge(userId, challenge, purpose) {
  const collection = $app.dao().findCollectionByNameOrId('webauthn_challenges');
  const record = new Record(collection);
  record.set('user', userId);
  record.set('challenge', challenge);
  record.set('purpose', purpose);
  record.set('expires_at', challengeExpiresAt());
  $app.dao().saveRecord(record);
  return record;
}

function consumeChallenge(userId, purpose) {
  const now = new Date().toISOString();
  const filter = `user = '${userId}' && purpose = '${purpose}' && expires_at > '${now}'`;
  const records = $app.dao().findRecordsByFilter('webauthn_challenges', filter, '-created', 1);
  if (records.length === 0) {
    throw new BadRequestError('Challenge not found or expired');
  }
  const record = records[0];
  $app.dao().deleteRecord(record);
  return record.get('challenge');
}

function saveVerifiedSession(session) {
  const collection = $app.dao().findCollectionByNameOrId('admin_verified_sessions');
  const record = new Record(collection);
  record.set('user', session.user_id);
  record.set('token_hash', session.token_hash);
  record.set('fingerprint_hash', session.fingerprint_hash);
  record.set('ip_hash', session.ip_hash);
  record.set('user_agent_hash', session.user_agent_hash);
  record.set('verified_at', session.verified_at);
  record.set('expires_at', session.expires_at);
  record.set('revoked_at', null);
  $app.dao().saveRecord(record);
  return record;
}

function findPasskeyByCredentialId(credentialId) {
  const filter = `credential_id = '${credentialId}' && revoked_at = null`;
  const records = $app.dao().findRecordsByFilter('admin_passkeys', filter, '-created', 1);
  return records.length > 0 ? records[0] : null;
}

function listActivePasskeys(userId) {
  const filter = `owner = '${userId}' && revoked_at = null`;
  return $app.dao().findRecordsByFilter('admin_passkeys', filter, '-created', 100);
}

function buildAllowCredentials(userId) {
  const passkeys = listActivePasskeys(userId);
  return passkeys.map((p) => ({
    id: p.get('credential_id'),
    type: 'public-key',
    transports: (p.get('transports') || '').split(',').filter(Boolean),
  }));
}

function verifySessionBinding(userId, c) {
  const token = getAuthToken(c);
  const fingerprint = getHeader(c, 'X-Admin-Fingerprint');
  const ip = getClientIP(c);
  const userAgent = getHeader(c, 'User-Agent');

  if (!token || !fingerprint || !userAgent) {
    return { verified: false };
  }

  const now = new Date().toISOString();
  const filter = `user = '${userId}' && revoked_at = null && expires_at > '${now}'`;
  const records = $app.dao().findRecordsByFilter('admin_verified_sessions', filter, '-expires_at', 1);
  if (records.length === 0) {
    return { verified: false };
  }

  const record = records[0];
  try {
    const res = postInternal('/internal/session/verify', {
      record: {
        token_hash: record.get('token_hash'),
        fingerprint_hash: record.get('fingerprint_hash'),
        ip_hash: record.get('ip_hash'),
        user_agent_hash: record.get('user_agent_hash'),
        expires_at: record.get('expires_at'),
        revoked_at: record.get('revoked_at'),
      },
      token,
      fingerprint,
      ip,
      userAgent,
    });
    return { verified: !!res.verified, expires_at: record.get('expires_at') };
  } catch (err) {
    console.error('session verify error:', err);
    return { verified: false };
  }
}

// Registration options (super admin only)
routerAdd('POST', '/api/blog-admin/webauthn/register/options', (c) => {
  const user = requireSuperAdmin(c);
  const userId = user.id;
  const userName = user.get('email') || user.get('username') || userId;
  const challenge = randomChallenge();

  const options = postInternal('/internal/webauthn/registration/options', {
    userId,
    userName,
    challenge,
  });

  saveChallenge(userId, challenge, 'registration');

  return c.json(200, options);
});

// Registration verify (super admin only)
routerAdd('POST', '/api/blog-admin/webauthn/register/verify', (c) => {
  const user = requireSuperAdmin(c);
  const userId = user.id;
  const body = JSON.parse(c.request().body ? c.request().body : '{}');
  const challenge = consumeChallenge(userId, 'registration');

  const result = postInternal('/internal/webauthn/registration/verify', {
    response: body.response,
    expectedChallenge: challenge,
  });

  if (!result.verified || !result.registrationInfo || !result.registrationInfo.credential) {
    throw new BadRequestError('Passkey registration failed');
  }

  const credential = result.registrationInfo.credential;
  const collection = $app.dao().findCollectionByNameOrId('admin_passkeys');
  const record = new Record(collection);
  record.set('owner', userId);
  record.set('label', body.label || 'Passkey');
  record.set('credential_id', credential.id);
  record.set('public_key', credential.publicKey);
  record.set('counter', credential.counter || 0);
  record.set('revoked_at', null);
  $app.dao().saveRecord(record);

  writeAuditLog({
    userId,
    action: 'admin_passkey_registered',
    targetCollection: 'admin_passkeys',
    targetId: record.id,
    summary: 'Registered admin passkey',
    ip: getClientIP(c),
  });

  return c.json(200, { verified: true, credentialId: credential.id });
});

// Authentication options (admin-capable users)
routerAdd('POST', '/api/blog-admin/webauthn/authenticate/options', (c) => {
  const user = requireAdminCapable(c);
  const userId = user.id;
  const challenge = randomChallenge();
  const allowCredentials = buildAllowCredentials(userId);

  if (allowCredentials.length === 0) {
    throw new BadRequestError('No active passkeys found');
  }

  const options = postInternal('/internal/webauthn/authentication/options', {
    challenge,
    allowCredentials,
  });

  saveChallenge(userId, challenge, 'authentication');

  return c.json(200, options);
});

// Authentication verify (admin-capable users)
routerAdd('POST', '/api/blog-admin/webauthn/authenticate/verify', (c) => {
  const user = requireAdminCapable(c);
  const userId = user.id;
  const body = JSON.parse(c.request().body ? c.request().body : '{}');
  const challenge = consumeChallenge(userId, 'authentication');

  const credentialId = body.response && body.response.id;
  if (!credentialId) {
    throw new BadRequestError('Missing credential id');
  }

  const passkey = findPasskeyByCredentialId(credentialId);
  if (!passkey) {
    throw new BadRequestError('Passkey not found');
  }

  const authenticator = {
    credentialID: passkey.get('credential_id'),
    credentialPublicKey: passkey.get('public_key'),
    counter: passkey.get('counter') || 0,
  };

  const result = postInternal('/internal/webauthn/authentication/verify', {
    response: body.response,
    expectedChallenge: challenge,
    authenticator,
    userId,
    token: getAuthToken(c),
    fingerprint: getHeader(c, 'X-Admin-Fingerprint'),
    ip: getClientIP(c),
    userAgent: getHeader(c, 'User-Agent'),
  });

  if (!result.verified) {
    throw new BadRequestError('Passkey authentication failed');
  }

  if (result.authenticationInfo && typeof result.authenticationInfo.newCounter === 'number') {
    passkey.set('counter', result.authenticationInfo.newCounter);
    $app.dao().saveRecord(passkey);
  }

  const sessionRecord = saveVerifiedSession(result.session);

  writeAuditLog({
    userId,
    action: 'admin_session_verified',
    targetCollection: 'admin_verified_sessions',
    targetId: sessionRecord.id,
    summary: 'Verified admin session via passkey',
    ip: getClientIP(c),
  });

  return c.json(200, {
    verified: true,
    expires_at: result.session.expires_at,
  });
});

// Session status (admin-capable users)
routerAdd('GET', '/api/blog-admin/webauthn/session', (c) => {
  const user = requireAdminCapable(c);
  const result = verifySessionBinding(user.id, c);
  return c.json(200, result);
});
