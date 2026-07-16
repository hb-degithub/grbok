'use strict';

var stepUp = require('./admin_step_up.js');
var audits = require('./admin_security_audit.js');
var INTERNAL_URL = String($os.getenv('ADMIN_AUTH_INTERNAL_URL') || '').trim() || 'http://admin-auth:8787';
var INTERNAL_SECRET = String($os.getenv('ADMIN_AUTH_INTERNAL_SECRET') || '').trim();
var HASH_SECRET = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '').trim();
var ADMIN_ROLES = ['author', 'admin', 'super_admin'];
var CHALLENGE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var CHALLENGE_BINDING_REQUIRED = 'ADMIN_STEP_UP_REQUIRED';

function apiError(status, code) {
  throw new ApiError(status, code);
}

function actor(c) {
  try { return c.get('authRecord') || null; } catch (_) { return null; }
}

function requireAdmin(c, superOnly) {
  var user = actor(c);
  var role = user ? String(user.get('role') || '').trim() : '';
  if (!user || ADMIN_ROLES.indexOf(role) === -1) apiError(401, 'AUTH_REQUIRED');
  if (superOnly && role !== 'super_admin') apiError(403, 'AUTH_REQUIRED');
  if (!user.verified()) apiError(403, 'AUTH_REQUIRED');
  return user;
}

function trustedAdminIp(c) {
  var actual = '';
  try { actual = String(c.realIP() || '').trim(); } catch (_) {}
  var configured = String($os.getenv('ADMIN_IP') || '').split(/[\s,]+/).filter(Boolean);
  return actual && configured.indexOf(actual) !== -1;
}

function requireTrustedAdminIp(c) {
  if (!trustedAdminIp(c)) apiError(403, 'ADMIN_NETWORK_DENIED');
}

function header(c, name) {
  try { return String(c.request().header.get(name) || '').trim(); } catch (_) { return ''; }
}

function challengeClientSessionHmac(c) {
  var clientSession = header(c, 'X-Admin-Session');
  if (!clientSession || HASH_SECRET.length < 32) apiError(403, CHALLENGE_BINDING_REQUIRED);
  return $security.hs256('step-up-client-session:' + clientSession, HASH_SECRET);
}

function body(c) {
  try { return JSON.parse(readerToString(c.request().body, 1048577) || '{}'); }
  catch (_) { apiError(400, 'INVALID_REQUEST'); }
}

function postInternal(path, payload) {
  if (!INTERNAL_SECRET) throw new Error('admin-auth internal secret missing');
  var response = $http.send({
    url: INTERNAL_URL + path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
    body: JSON.stringify(payload),
    timeout: 10,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('admin-auth request failed');
  return JSON.parse(String(response.raw || '{}'));
}

function records(dao, collection, filter, sort, limit, params) {
  return dao.findRecordsByFilter(collection, filter, sort || '', limit || 100, 0, params || {});
}

function dateMillis(value) {
  return Date.parse(String(value || '').replace(' ', 'T'));
}

function pbDate(value) {
  return new Date(value).toISOString().replace('T', ' ');
}

function passkeyState(dao, userId) {
  var found = records(dao, 'admin_passkey_state', 'user = {:user}', '', 1, { user: userId });
  return found && found.length ? found[0] : null;
}

function activePasskeys(dao, userId) {
  return records(dao, 'admin_passkeys', 'owner = {:user} && revoked_at = null', '-created', 100, { user: userId });
}

function recoveryCodeHmac(code) {
  if (!code || HASH_SECRET.length < 32) return '';
  return $security.hs256('admin-recovery-reenroll:' + String(code), HASH_SECRET);
}

function validRecoveryState(state, c) {
  if (!state) return false;
  var code = header(c, 'X-Admin-Recovery-Code');
  var stored = state.getString('recovery_nonce_hmac');
  var expiresAt = dateMillis(state.getString('recovery_expires_at'));
  var expected = recoveryCodeHmac(code);
  return !!(code && stored && expected && isFinite(expiresAt) && expiresAt > Date.now() && $security.equal(stored, expected));
}

function registrationMode(dao, userId, c) {
  var state = passkeyState(dao, userId);
  if (!state || !state.getString('bootstrapped_at')) return 'bootstrap_registration';
  if (c && validRecoveryState(state, c)) return 'recovery_registration';
  return 'add_registration';
}

function invalidateChallenges(dao, userId, purpose) {
  var found = records(dao, 'webauthn_challenges', 'user = {:user} && purpose = {:purpose}', '', 100, { user: userId, purpose: purpose });
  for (var i = 0; i < found.length; i++) dao.deleteRecord(found[i]);
}

function replaceChallenge(input) {
  $app.dao().runInTransaction(function (txDao) {
    invalidateChallenges(txDao, input.userId, input.purpose);
    var collection = txDao.findCollectionByNameOrId('webauthn_challenges');
    var record = new Record(collection);
    record.set('user', input.userId);
    record.set('challenge', input.challenge);
    record.set('purpose', input.purpose);
    record.set('binding_selector', input.bindingSelector || '');
    record.set('client_session_hmac', input.clientSessionHmac || '');
    record.set('expires_at', new Date(Date.now() + 5 * 60 * 1000).toISOString());
    txDao.saveRecord(record);
  });
}

function findChallenge(dao, userId, purpose) {
  var now = pbDate(Date.now());
  var found = records(
    dao,
    'webauthn_challenges',
    'user = {:user} && purpose = {:purpose} && expires_at > {:now}',
    '-created',
    1,
    { user: userId, purpose: purpose, now: now },
  );
  if (!found || !found.length) apiError(400, 'CHALLENGE_REQUIRED');
  return found[0];
}

function assertSameChallenge(current, snapshot) {
  if (!current || !snapshot || current.id !== snapshot.id || current.getString('challenge') !== snapshot.getString('challenge')) {
    apiError(400, 'CHALLENGE_REQUIRED');
  }
  if (dateMillis(current.getString('expires_at')) <= Date.now()) apiError(400, 'CHALLENGE_REQUIRED');
}

function assertChallengeBinding(challenge, c) {
  if (challenge.getString('client_session_hmac') !== challengeClientSessionHmac(c)) {
    apiError(403, CHALLENGE_BINDING_REQUIRED);
  }
}

function passkeyDto(record, currentCredentialId, activeCount) {
  return {
    id: record.id,
    label: record.getString('label') || 'Passkey',
    created: record.getString('created'),
    revokedAt: record.getString('revoked_at') || null,
    current: currentCredentialId
      ? record.getString('credential_id') === currentCredentialId
      : (!record.getString('revoked_at') && activeCount === 1),
  };
}

function listPasskeys(c) {
  var user = requireAdmin(c, true);
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  var items = records($app.dao(), 'admin_passkeys', 'owner = {:user}', '-created', 100, { user: user.id });
  var activeCount = activePasskeys($app.dao(), user.id).length;
  return c.json(200, { items: items.map(function (item) { return passkeyDto(item, '', activeCount); }) });
}

function revokePasskey(c) {
  var user = requireAdmin(c, true);
  requireTrustedAdminIp(c);
  var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  var id = String(c.pathParam('id') || '');
  var result;
  $app.dao().runInTransaction(function (txDao) {
    var target;
    try { target = txDao.findRecordById('admin_passkeys', id); } catch (_) { apiError(404, 'PASSKEY_NOT_FOUND'); }
    if (target.getString('owner') !== user.id || target.getString('revoked_at')) apiError(404, 'PASSKEY_NOT_FOUND');
    var active = activePasskeys(txDao, user.id);
    if (active.length <= 1) apiError(409, 'LAST_PASSKEY_REQUIRED');
    var before = { active: true, label: target.getString('label') || 'Passkey' };
    target.set('revoked_at', new Date().toISOString());
    txDao.saveRecord(target);
    audits.writeSecurityAudit(txDao, secure, {
      actionCode: 'ADMIN_PASSKEY_REVOKED', targetType: 'admin_passkey', targetId: target.id,
      before: before, after: { active: false, label: before.label }, version: 1,
    });
    result = passkeyDto(target, '', active.length - 1);
  });
  return c.json(200, { item: result });
}

function stepUpStatus(c) {
  var user = requireAdmin(c, false);
  var mode = registrationMode($app.dao(), user.id, c);
  if (mode === 'bootstrap_registration') {
    return c.json(200, { status: trustedAdminIp(c) && String(user.get('role')) === 'super_admin' ? 'bootstrap_required' : 'expired', verified: false });
  }
  if (mode === 'recovery_registration') return c.json(200, { status: 'recovery_reenroll', verified: false });
  if (activePasskeys($app.dao(), user.id).length === 0) return c.json(200, { status: 'expired', verified: false });
  try {
    var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
    var row = records($app.dao(), 'admin_step_up_sessions', 'selector = {:selector}', '', 1, { selector: secure.selector })[0];
    return c.json(200, { status: 'verified', verified: true, expiresAt: row ? row.getString('expires_at') : '' });
  } catch (_) {
    return c.json(200, { status: header(c, 'X-Admin-Step-Up') ? 'binding_changed' : 'expired', verified: false });
  }
}

function revokeStepUp(c) {
  requireAdmin(c, false);
  var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  $app.dao().runInTransaction(function (txDao) {
    var found = records(txDao, 'admin_step_up_sessions', 'selector = {:selector}', '', 1, { selector: secure.selector });
    if (!found.length || found[0].getString('revoked_at')) apiError(403, 'ADMIN_STEP_UP_REQUIRED');
    found[0].set('revoked_at', new Date().toISOString());
    txDao.saveRecord(found[0]);
    audits.writeSecurityAudit(txDao, secure, {
      actionCode: 'ADMIN_STEP_UP_REVOKED',
      targetType: 'admin_step_up_session',
      targetId: found[0].id,
      before: { active: true },
      after: { active: false },
      version: 1,
    });
  });
  return c.json(200, { revoked: true });
}

function authenticationOptions(c) {
  var user = requireAdmin(c, false);
  var clientSessionHmac = challengeClientSessionHmac(c);
  var passkeys = activePasskeys($app.dao(), user.id);
  if (!passkeys.length) apiError(409, 'PASSKEY_REQUIRED');
  var challenge = $security.randomStringWithAlphabet(43, CHALLENGE_ALPHABET);
  var options = postInternal('/internal/webauthn/authentication/options', {
    challenge: challenge,
    allowCredentials: passkeys.map(function (item) { return { id: item.getString('credential_id'), type: 'public-key' }; }),
  });
  replaceChallenge({
    userId: user.id,
    purpose: 'authentication',
    challenge: challenge,
    clientSessionHmac: clientSessionHmac,
  });
  return c.json(200, options);
}

function authenticationVerify(c) {
  var user = requireAdmin(c, false);
  var input = body(c);
  var clientSession = header(c, 'X-Admin-Session');
  var fingerprint = header(c, 'X-Browser-Fingerprint');
  var userAgent = header(c, 'User-Agent');
  var ip = String(c.realIP() || '').trim();
  if (!clientSession || !fingerprint || !userAgent || !ip) apiError(400, 'INVALID_REQUEST');
  var challenge = findChallenge($app.dao(), user.id, 'authentication');
  assertChallengeBinding(challenge, c);
  var credentialId = input.response && input.response.id ? String(input.response.id) : '';
  var found = records($app.dao(), 'admin_passkeys', 'owner = {:user} && credential_id = {:credential} && revoked_at = null', '', 1, { user: user.id, credential: credentialId });
  if (!found.length) apiError(400, 'PASSKEY_VERIFICATION_FAILED');
  var passkey = found[0];
  var verified = postInternal('/internal/webauthn/authentication/verify', {
    response: input.response,
    expectedChallenge: challenge.getString('challenge'),
    authenticator: { credentialID: passkey.getString('credential_id'), credentialPublicKey: passkey.getString('public_key'), counter: passkey.get('counter') || 0 },
    userId: user.id, token: header(c, 'Authorization').replace(/^Bearer\s+/i, ''), fingerprint: fingerprint, ip: ip, userAgent: userAgent,
  });
  if (!verified.verified) apiError(400, 'PASSKEY_VERIFICATION_FAILED');
  var issued = postInternal('/internal/step-up/issue', { userId: user.id, clientSession: clientSession, fingerprint: fingerprint, ip: ip, userAgent: userAgent });
  var saved;
  $app.dao().runInTransaction(function (txDao) {
    var currentChallenge = findChallenge(txDao, user.id, 'authentication');
    assertSameChallenge(currentChallenge, challenge);
    assertChallengeBinding(currentChallenge, c);
    txDao.deleteRecord(currentChallenge);
    var currentPasskey = txDao.findRecordById('admin_passkeys', passkey.id);
    if (currentPasskey.getString('owner') !== user.id || currentPasskey.getString('revoked_at')) apiError(400, 'PASSKEY_VERIFICATION_FAILED');
    var old = records(txDao, 'admin_step_up_sessions', 'user = {:user} && client_session_hmac = {:client} && revoked_at = null', '', 100, { user: user.id, client: issued.record.client_session_hmac });
    for (var i = 0; i < old.length; i++) { old[i].set('revoked_at', new Date().toISOString()); txDao.saveRecord(old[i]); }
    var collection = txDao.findCollectionByNameOrId('admin_step_up_sessions');
    saved = new Record(collection);
    Object.keys(issued.record).forEach(function (key) { saved.set(key, issued.record[key]); });
    txDao.saveRecord(saved);
    if (verified.authenticationInfo && typeof verified.authenticationInfo.newCounter === 'number') {
      currentPasskey.set('counter', verified.authenticationInfo.newCounter); txDao.saveRecord(currentPasskey);
    }
    audits.writeSecurityAudit(txDao, { actorId: user.id, referenceId: $security.randomStringWithAlphabet(22, CHALLENGE_ALPHABET) }, {
      actionCode: 'ADMIN_STEP_UP_VERIFIED', targetType: 'admin_step_up_session', targetId: saved.id,
      before: null, after: { active: true }, version: 1,
    });
  });
  return c.json(200, { verified: true, credential: issued.credential, expiresAt: issued.record.expires_at });
}

function registrationOptions(c) {
  var user = requireAdmin(c, true);
  requireTrustedAdminIp(c);
  var mode = registrationMode($app.dao(), user.id, c);
  var clientSessionHmac = challengeClientSessionHmac(c);
  var secure = null;
  if (mode === 'add_registration') secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  var challenge = $security.randomStringWithAlphabet(43, CHALLENGE_ALPHABET);
  var options = postInternal('/internal/webauthn/registration/options', {
    userId: user.id,
    userName: user.getString('email') || user.getString('username') || user.id,
    challenge: challenge,
  });
  replaceChallenge({
    userId: user.id, purpose: mode, challenge: challenge,
    bindingSelector: secure ? secure.selector : '',
    clientSessionHmac: clientSessionHmac,
  });
  options.registrationMode = mode;
  return c.json(200, options);
}

function registrationVerify(c) {
  var user = requireAdmin(c, true);
  requireTrustedAdminIp(c);
  var input = body(c);
  var mode = registrationMode($app.dao(), user.id, c);
  var clientSessionHmac = challengeClientSessionHmac(c);
  var challenge = findChallenge($app.dao(), user.id, mode);
  var secure = null;
  assertChallengeBinding(challenge, c);
  if (mode === 'add_registration') {
    secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
    if (challenge.getString('binding_selector') !== secure.selector || challenge.getString('client_session_hmac') !== secure.clientSessionHmac) {
      apiError(403, 'ADMIN_STEP_UP_REQUIRED');
    }
  } else if (mode === 'bootstrap_registration' && passkeyState($app.dao(), user.id)) {
    apiError(409, 'PASSKEY_ALREADY_BOOTSTRAPPED');
  }
  var verified = postInternal('/internal/webauthn/registration/verify', { response: input.response, expectedChallenge: challenge.getString('challenge') });
  if (!verified.verified || !verified.registrationInfo || !verified.registrationInfo.credential) apiError(400, 'PASSKEY_REGISTRATION_FAILED');
  var credential = verified.registrationInfo.credential;
  var saved;
  $app.dao().runInTransaction(function (txDao) {
    var currentChallenge = findChallenge(txDao, user.id, mode);
    assertSameChallenge(currentChallenge, challenge);
    assertChallengeBinding(currentChallenge, c);
    var txSecure = null;
    if (mode === 'add_registration') {
      txSecure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true, dao: txDao });
      if (currentChallenge.getString('binding_selector') !== txSecure.selector || currentChallenge.getString('client_session_hmac') !== txSecure.clientSessionHmac) {
        apiError(403, 'ADMIN_STEP_UP_REQUIRED');
      }
    }
    if (mode === 'bootstrap_registration' && passkeyState(txDao, user.id)) apiError(409, 'PASSKEY_ALREADY_BOOTSTRAPPED');
    var txState = passkeyState(txDao, user.id);
    if (mode === 'recovery_registration') {
      if (!txState || !txState.getString('bootstrapped_at') || !validRecoveryState(txState, c)) apiError(403, 'ADMIN_RECOVERY_REQUIRED');
      txState.set('recovery_nonce_hmac', '');
      txState.set('recovery_expires_at', '');
      txDao.saveRecord(txState);
    }
    txDao.deleteRecord(currentChallenge);
    var collection = txDao.findCollectionByNameOrId('admin_passkeys');
    saved = new Record(collection);
    saved.set('owner', user.id); saved.set('label', String(input.label || 'Passkey').slice(0, 255));
    saved.set('credential_id', credential.id); saved.set('public_key', credential.publicKey);
    saved.set('counter', credential.counter || 0); saved.set('revoked_at', ''); txDao.saveRecord(saved);
    if (mode === 'bootstrap_registration') {
      var state = new Record(txDao.findCollectionByNameOrId('admin_passkey_state'));
      state.set('user', user.id); state.set('bootstrapped_at', new Date().toISOString()); txDao.saveRecord(state);
    }
    audits.writeSecurityAudit(txDao, txSecure || secure || { actorId: user.id, referenceId: $security.randomStringWithAlphabet(22, CHALLENGE_ALPHABET) }, {
      actionCode: mode === 'recovery_registration' ? 'ADMIN_PASSKEY_RECOVERY_REGISTERED' : 'ADMIN_PASSKEY_REGISTERED', targetType: 'admin_passkey', targetId: saved.id,
      before: null, after: { active: true, label: saved.getString('label') }, version: 1,
    });
  });
  return c.json(200, { verified: true, item: passkeyDto(saved, credential.id, activePasskeys($app.dao(), user.id).length) });
}

function requireLocalAdmin(c) {
  var admin = null;
  try { admin = c.get('admin') || null; } catch (_) {}
  if (!admin) apiError(401, 'AUTH_REQUIRED');
  requireTrustedAdminIp(c);
  return admin;
}

function localRecovery(c) {
  requireLocalAdmin(c);
  var input = body(c);
  var email = String(input.email || '').trim().toLowerCase();
  if (!email || email.length > 320) apiError(400, 'INVALID_REQUEST');
  var recoveryCode = $security.randomStringWithAlphabet(43, CHALLENGE_ALPHABET);
  var referenceId = $security.randomStringWithAlphabet(22, CHALLENGE_ALPHABET);
  var expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  var result = null;

  $app.dao().runInTransaction(function (txDao) {
    var users = records(txDao, 'users', 'email = {:email}', '', 1, { email: email });
    if (!users.length) apiError(404, 'USER_NOT_FOUND');
    var user = users[0];
    if (user.getString('role') !== 'super_admin' || !user.verified()) apiError(403, 'AUTH_REQUIRED');
    var state = passkeyState(txDao, user.id);
    if (!state || !state.getString('bootstrapped_at')) apiError(409, 'PASSKEY_NOT_BOOTSTRAPPED');
    var now = new Date().toISOString();
    var passkeys = activePasskeys(txDao, user.id);
    for (var i = 0; i < passkeys.length; i++) { passkeys[i].set('revoked_at', now); txDao.saveRecord(passkeys[i]); }
    var stepUps = records(txDao, 'admin_step_up_sessions', 'user = {:user} && revoked_at = null', '', 1000, { user: user.id });
    for (var j = 0; j < stepUps.length; j++) { stepUps[j].set('revoked_at', now); txDao.saveRecord(stepUps[j]); }
    var legacy = records(txDao, 'admin_verified_sessions', 'user = {:user} && revoked_at = null', '', 1000, { user: user.id });
    for (var k = 0; k < legacy.length; k++) { legacy[k].set('revoked_at', now); txDao.saveRecord(legacy[k]); }
    state.set('recovery_nonce_hmac', recoveryCodeHmac(recoveryCode));
    state.set('recovery_expires_at', expiresAt);
    txDao.saveRecord(state);
    audits.writeSecurityAudit(txDao, {
      actorId: '',
      referenceId: referenceId,
      failAudit: header(c, 'X-Test-Fail-Audit') === '1',
    }, {
      actionCode: 'ADMIN_LOCAL_RECOVERY',
      targetType: 'user',
      targetId: user.id,
      before: { activePasskeys: passkeys.length, activeStepUps: stepUps.length },
      after: { activePasskeys: 0, activeStepUps: 0, recoveryPending: true },
      version: 1,
      priority: 'high',
    });
    result = { passkeys: passkeys.length, stepUps: stepUps.length, legacySessions: legacy.length };
  });

  return c.json(200, {
    recoveryCode: recoveryCode,
    expiresAt: expiresAt,
    referenceId: referenceId,
    counts: result,
  });
}

module.exports = {
  listPasskeys: listPasskeys,
  revokePasskey: revokePasskey,
  stepUpStatus: stepUpStatus,
  authenticationOptions: authenticationOptions,
  authenticationVerify: authenticationVerify,
  registrationOptions: registrationOptions,
  registrationVerify: registrationVerify,
  revokeStepUp: revokeStepUp,
  localRecovery: localRecovery,
};
