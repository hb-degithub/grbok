'use strict';

var CREDENTIAL_PATTERN = /^v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/;
var ADMIN_ROLES = ['author', 'admin', 'super_admin'];
var REFERENCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var PROTECTED_COLLECTIONS = [
  'posts', 'comments', 'tags', 'post_tags', 'users', 'friend_links',
  'announcements', 'media_assets', 'settings', 'post_versions',
];
var SAFE_SELF_PROFILE_FIELDS = ['name', 'username', 'avatar'];

function forbidden() {
  var referenceId = $security.randomStringWithAlphabet(22, REFERENCE_ALPHABET);
  console.error('[admin-step-up-denied] reference=' + referenceId);
  throw new ForbiddenError('ADMIN_STEP_UP_REQUIRED');
}

function requestContext(ctx) {
  return ctx && ctx.httpContext ? ctx.httpContext : ctx;
}

function currentActor(ctx) {
  if (ctx && ctx.auth) return ctx.auth;
  var c = requestContext(ctx);
  try {
    var info = $apis.requestInfo(c);
    if (info.auth) return info.auth;
    if (info.authRecord) return info.authRecord;
  } catch (_) {}
  try {
    return c.get('authRecord') || c.get('auth') || null;
  } catch (_) {
    return null;
  }
}

function header(ctx, name) {
  var c = requestContext(ctx);
  try {
    return String(c.request().header.get(name) || '').trim();
  } catch (_) {
    return '';
  }
}

function clientIp(ctx) {
  var c = requestContext(ctx);
  try {
    return String(c.realIP() || '').trim();
  } catch (_) {
    return '';
  }
}

function hash(secret, namespace, value) {
  return $security.hs256(namespace + ':' + String(value), secret);
}

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return $security.equal(left, right);
}

function findBySelector(selector) {
  var records = $app.dao().findRecordsByFilter(
    'admin_step_up_sessions',
    'selector = {:selector}',
    '',
    1,
    0,
    { selector: selector },
  );
  return records && records.length === 1 ? records[0] : null;
}

function dateMillis(value) {
  return Date.parse(String(value || '').replace(' ', 'T'));
}

function requireAdminStepUp(ctx, options) {
  options = options || {};
  try {
    var actor = currentActor(ctx);
    var role = actor ? String(actor.get('role') || '').trim() : '';
    if (!actor || ADMIN_ROLES.indexOf(role) === -1) forbidden();
    if (options.requireVerifiedEmail && !actor.verified()) forbidden();

    var credential = header(ctx, 'X-Admin-Step-Up');
    var match = CREDENTIAL_PATTERN.exec(credential);
    if (!match) forbidden();
    var selector = match[1];
    var rawSecret = match[2];
    var clientSession = header(ctx, 'X-Admin-Session');
    var fingerprint = header(ctx, 'X-Browser-Fingerprint');
    var ip = clientIp(ctx);
    var userAgent = header(ctx, 'User-Agent');
    if (!clientSession || !fingerprint || !ip || !userAgent) forbidden();

    var hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    if (hashSecret.length < 32) forbidden();
    var record = findBySelector(selector);
    if (!record) forbidden();
    if (record.getString('user') !== actor.id) forbidden();
    if (record.getString('revoked_at')) forbidden();
    var expiresAt = dateMillis(record.getString('expires_at'));
    if (!isFinite(expiresAt) || expiresAt <= Date.now()) forbidden();
    if (!equal(record.getString('secret_hmac'), hash(hashSecret, 'step-up-secret', rawSecret))) forbidden();
    if (!equal(record.getString('client_session_hmac'), hash(hashSecret, 'step-up-client-session', clientSession))) forbidden();
    if (!equal(record.getString('fingerprint_hash'), hash(hashSecret, 'step-up-fingerprint', fingerprint))) forbidden();
    if (!equal(record.getString('ip_hash'), hash(hashSecret, 'step-up-ip', ip))) forbidden();
    if (!equal(record.getString('user_agent_hash'), hash(hashSecret, 'step-up-ua', userAgent))) forbidden();

    return {
      actor: actor,
      actorId: actor.id,
      selector: selector,
      clientSessionHmac: record.getString('client_session_hmac'),
      referenceId: $security.randomStringWithAlphabet(22, REFERENCE_ALPHABET),
      clientIp: ip,
    };
  } catch (error) {
    if (error && error.message === 'ADMIN_STEP_UP_REQUIRED') throw error;
    forbidden();
  }
}

function requireProtectedWrite(e) {
  var collection = e.record && e.record.collection ? e.record.collection().name : '';
  if (PROTECTED_COLLECTIONS.indexOf(collection) === -1) return;

  var actor = currentActor(e);
  if (!actor) return;
  var role = String(actor.get('role') || '').trim();
  if (ADMIN_ROLES.indexOf(role) === -1) return;

  if (collection === 'users' && e.record.id === actor.id) {
    var stored = $app.dao().findRecordById('users', actor.id);
    var changedUnsafe = false;
    var fields = e.record.collection().schema.fields();
    for (var i = 0; i < fields.length; i++) {
      var name = fields[i].name;
      if (name === 'id' || name === 'created' || name === 'updated') continue;
      if (SAFE_SELF_PROFILE_FIELDS.indexOf(name) !== -1) continue;
      if (JSON.stringify(stored.get(name)) !== JSON.stringify(e.record.get(name))) {
        changedUnsafe = true;
        break;
      }
    }
    if (!changedUnsafe) return;
  }

  requireAdminStepUp(e.httpContext || e, { requireVerifiedEmail: true });
}

module.exports = {
  requireAdminStepUp: requireAdminStepUp,
  requireProtectedWrite: requireProtectedWrite,
};
