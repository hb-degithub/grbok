'use strict';

// ============================================================================
// 管理员 TOTP 二次验证 — HTTP 处理器
// 替代原 WebAuthn Passkey 链路（admin_security.js 的 passkey 部分）。
// step-up 会话签发复用 admin-auth 的 /internal/step-up/issue（与因子无关）。
// ============================================================================

var stepUp = require('./admin_step_up.js');
var audits = require('./admin_security_audit.js');
var totp = require('./admin_totp.js');

var INTERNAL_URL = String($os.getenv('ADMIN_AUTH_INTERNAL_URL') || '').trim() || 'http://admin-auth:8787';
var INTERNAL_SECRET = String($os.getenv('ADMIN_AUTH_INTERNAL_SECRET') || '').trim();
var HASH_SECRET = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '').trim();
var SITE_NAME = String($os.getenv('PUBLIC_SITE_NAME') || '').trim() || '个人博客';
var ADMIN_ROLES = ['author', 'admin', 'super_admin'];
// 强制 TOTP 的角色：仅 admin / super_admin；author 等其他角色免二次验证
var TOTP_ENFORCED_ROLES = ['admin', 'super_admin'];
var REFERENCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var COLLECTION = 'admin_totp_secrets';

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
  // superOnly 语义 = 仅强制 TOTP 的角色（admin / super_admin）可操作绑定、吊销、恢复
  if (superOnly && TOTP_ENFORCED_ROLES.indexOf(role) === -1) apiError(403, 'AUTH_REQUIRED');
  if (!user.verified()) apiError(403, 'AUTH_REQUIRED');
  return user;
}

function isLoopbackAddress(value) {
  var normalized = String(value || '').trim().toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.indexOf('::ffff:') === 0) normalized = normalized.slice(7);
  var parts = normalized.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return false;
    var octet = Number(parts[i]);
    if (!isFinite(octet) || octet < 0 || octet > 255) return false;
  }
  return true;
}

function requireLoopbackRealIp(c) {
  var actual = '';
  try { actual = String(c.realIP() || '').trim(); } catch (_) {}
  if (!isLoopbackAddress(actual)) apiError(403, 'ADMIN_NETWORK_DENIED');
}

function header(c, name) {
  try { return String(c.request().header.get(name) || '').trim(); } catch (_) { return ''; }
}

function body(c) {
  try { return JSON.parse(readerToString(c.request().body, 1048577) || '{}'); }
  catch (_) { apiError(400, 'INVALID_REQUEST'); }
}

function records(dao, collection, filter, sort, limit, params) {
  return dao.findRecordsByFilter(collection, filter, sort || '', limit || 100, 0, params || {});
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

// ---------- TOTP 状态 ----------

function totpState(dao, userId) {
  var found = records(dao, COLLECTION, 'user = {:user}', '', 1, { user: userId });
  return found && found.length ? found[0] : null;
}

function isBound(state) {
  return !!(state && state.getString('confirmed_at') && !state.getString('revoked_at') && state.getString('secret_enc'));
}

function recoveryCodeHmac(code) {
  return $security.hs256('admin-recovery:' + String(code), HASH_SECRET);
}

function validRecoveryState(state, c) {
  if (!state || HASH_SECRET.length < 32) return false;
  var code = header(c, 'X-Admin-Recovery-Code');
  var stored = state.getString('recovery_nonce_hmac');
  var expiresAt = Date.parse(String(state.getString('recovery_expires_at') || '').replace(' ', 'T'));
  var expected = recoveryCodeHmac(code);
  return !!(code && stored && expected && isFinite(expiresAt) && expiresAt > Date.now() && $security.equal(stored, expected));
}

// 绑定模式：setup（未绑定）/ recovery（恢复码重绑）/ rebind（已绑定重新绑定，需 step-up）
function setupMode(dao, userId, c) {
  var state = totpState(dao, userId);
  if (!isBound(state)) {
    if (state && validRecoveryState(state, c)) return 'recovery';
    return 'setup';
  }
  return 'rebind';
}

function requestMeta(c) {
  var clientSession = header(c, 'X-Admin-Session');
  var fingerprint = header(c, 'X-Browser-Fingerprint');
  var userAgent = header(c, 'User-Agent');
  var ip = require('./client_ip.js').clientIp(c);
  if (!clientSession || !fingerprint || !userAgent || !ip) apiError(400, 'INVALID_REQUEST');
  return { clientSession: clientSession, fingerprint: fingerprint, userAgent: userAgent, ip: ip };
}

// 签发 step-up 会话（复用 admin-auth，与因子无关）
function issueStepUpSession(c, user) {
  var meta = requestMeta(c);
  var issued = postInternal('/internal/step-up/issue', {
    userId: user.id,
    clientSession: meta.clientSession,
    fingerprint: meta.fingerprint,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return issued;
}

function saveStepUpRecord(txDao, issued) {
  var old = records(txDao, 'admin_step_up_sessions', 'user = {:user} && client_session_hmac = {:client} && revoked_at = null', '', 100, {
    user: issued.record.user,
    client: issued.record.client_session_hmac,
  });
  for (var i = 0; i < old.length; i++) {
    old[i].set('revoked_at', new Date().toISOString());
    txDao.saveRecord(old[i]);
  }
  var collection = txDao.findCollectionByNameOrId('admin_step_up_sessions');
  var saved = new Record(collection);
  Object.keys(issued.record).forEach(function (key) { saved.set(key, issued.record[key]); });
  txDao.saveRecord(saved);
  return saved;
}

function audit(c, txDao, user, actionCode, targetId, before, after) {
  audits.writeSecurityAudit(txDao, {
    actorId: user.id,
    referenceId: $security.randomStringWithAlphabet(22, REFERENCE_ALPHABET),
  }, {
    actionCode: actionCode,
    targetType: 'admin_totp_secret',
    targetId: targetId,
    before: before,
    after: after,
    version: 1,
  });
}

// ---------- HTTP 处理器 ----------

// GET /api/blog-admin/step-up/status（路由沿用，语义改 TOTP）
function stepUpStatus(c) {
  var user = requireAdmin(c, false);
  var role = String(user.get('role') || '').trim();
  // author 等非强制角色：不做二次验证，直接放行
  if (TOTP_ENFORCED_ROLES.indexOf(role) === -1) {
    return c.json(200, { status: 'verified', verified: true });
  }
  var state = totpState($app.dao(), user.id);
  if (!isBound(state)) {
    if (state && validRecoveryState(state, c)) {
      return c.json(200, { status: 'recovery_reenroll', verified: false });
    }
    return c.json(200, { status: 'totp_setup_required', verified: false });
  }
  try {
    var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
    var row = records($app.dao(), 'admin_step_up_sessions', 'selector = {:selector}', '', 1, { selector: secure.selector })[0];
    return c.json(200, { status: 'verified', verified: true, expiresAt: row ? row.getString('expires_at') : '' });
  } catch (_) {
    return c.json(200, { status: header(c, 'X-Admin-Step-Up') ? 'binding_changed' : 'expired', verified: false });
  }
}

// POST /api/blog-admin/totp/setup — 生成 secret，返回 otpauth URI + base32
function totpSetup(c) {
  var user = requireAdmin(c, true); // 仅 super_admin 可绑定
  var mode = setupMode($app.dao(), user.id, c);
  if (mode === 'rebind') {
    // 已绑定状态下重新生成需 step-up 保护
    stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  }
  if (mode === 'setup') {
    var existing = totpState($app.dao(), user.id);
    if (existing && existing.getString('confirmed_at')) apiError(409, 'TOTP_ALREADY_BOUND');
  }
  var secret = totp.generateSecret();
  var enc = totp.encryptSecret(secret.hex);
  $app.dao().runInTransaction(function (txDao) {
    var state = totpState(txDao, user.id);
    if (!state) {
      state = new Record(txDao.findCollectionByNameOrId(COLLECTION));
      state.set('user', user.id);
    }
    // 重复 setup 覆盖 pending（用户中途换手机重扫），已确认绑定不受影响
    state.set('secret_pending_enc', enc);
    txDao.saveRecord(state);
  });
  var email = user.getString('email') || user.getString('username') || user.id;
  return c.json(200, {
    uri: totp.buildOtpauthUri(secret.base32, email, SITE_NAME),
    base32: secret.base32,
    mode: mode,
  });
}

// POST /api/blog-admin/totp/confirm — 首枚 6 位码确认绑定
function totpConfirm(c) {
  var user = requireAdmin(c, true);
  var input = body(c);
  var mode = setupMode($app.dao(), user.id, c);
  var secure = null;
  if (mode === 'rebind') {
    secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  }
  var issued = null;
  var saved = null;
  var confirmedStateId = null;
  $app.dao().runInTransaction(function (txDao) {
    var state = totpState(txDao, user.id);
    if (!state || !state.getString('secret_pending_enc')) apiError(409, 'TOTP_SETUP_REQUIRED');
    var plainHex;
    try {
      plainHex = totp.decryptSecret(state.getString('secret_pending_enc'));
    } catch (_) {
      apiError(500, 'TOTP_SECRET_UNAVAILABLE');
    }
    var result = totp.verifyCode(totp.secretFromHex(plainHex), input.code, -1);
    if (!result.ok) apiError(400, result.replay ? 'TOTP_CODE_REPLAYED' : 'TOTP_CODE_INVALID');
    // 转正
    state.set('secret_enc', state.getString('secret_pending_enc'));
    state.set('secret_pending_enc', '');
    state.set('confirmed_at', new Date().toISOString());
    state.set('revoked_at', '');
    state.set('last_used_timestep', result.timestep);
    // recovery 模式下清除恢复码
    if (mode === 'recovery') {
      if (!validRecoveryState(state, c)) apiError(403, 'ADMIN_RECOVERY_REQUIRED');
      state.set('recovery_nonce_hmac', '');
      state.set('recovery_expires_at', '');
    }
    txDao.saveRecord(state);
    confirmedStateId = state.id;
    // 绑定成功即签发 step-up，避免刚绑完立刻再输一次码
    issued = issueStepUpSession(c, user);
    saved = saveStepUpRecord(txDao, issued);
    audit(c, txDao, user, mode === 'recovery' ? 'ADMIN_TOTP_RECOVERY_BOUND' : 'ADMIN_TOTP_BOUND', state.id, null, { bound: true, mode: mode });
  });
  return c.json(200, { verified: true, credential: issued.credential, expiresAt: saved.getString('expires_at') });
}

// POST /api/blog-admin/totp/verify — step-up 验证（6 位码）
function totpVerify(c) {
  var user = requireAdmin(c, false);
  var input = body(c);
  var issued = null;
  var saved = null;
  $app.dao().runInTransaction(function (txDao) {
    var state = totpState(txDao, user.id);
    if (!isBound(state)) apiError(409, 'TOTP_NOT_BOUND');
    var plainHex;
    try {
      plainHex = totp.decryptSecret(state.getString('secret_enc'));
    } catch (_) {
      apiError(500, 'TOTP_SECRET_UNAVAILABLE');
    }
    var lastUsed = Number(state.get('last_used_timestep') || -1);
    var result = totp.verifyCode(totp.secretFromHex(plainHex), input.code, lastUsed);
    if (!result.ok) apiError(400, result.replay ? 'TOTP_CODE_REPLAYED' : 'TOTP_CODE_INVALID');
    // 事务内更新防重放水线
    state.set('last_used_timestep', result.timestep);
    txDao.saveRecord(state);
    issued = issueStepUpSession(c, user);
    saved = saveStepUpRecord(txDao, issued);
    audit(c, txDao, user, 'ADMIN_STEP_UP_VERIFIED', saved.id, null, { active: true, factor: 'totp' });
  });
  return c.json(200, { verified: true, credential: issued.credential, expiresAt: saved.getString('expires_at') });
}

// POST /api/blog-admin/totp/revoke — 吊销绑定（需有效 step-up）
function totpRevoke(c) {
  var user = requireAdmin(c, true);
  stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  $app.dao().runInTransaction(function (txDao) {
    var state = totpState(txDao, user.id);
    if (!isBound(state)) apiError(404, 'TOTP_NOT_BOUND');
    var now = new Date().toISOString();
    state.set('revoked_at', now);
    state.set('secret_enc', '');
    state.set('secret_pending_enc', '');
    state.set('confirmed_at', '');
    txDao.saveRecord(state);
    // 吊销绑定同时吊销全部 step-up 会话
    var sessions = records(txDao, 'admin_step_up_sessions', 'user = {:user} && revoked_at = null', '', 100, { user: user.id });
    for (var i = 0; i < sessions.length; i++) {
      sessions[i].set('revoked_at', now);
      txDao.saveRecord(sessions[i]);
    }
    audit(c, txDao, user, 'ADMIN_TOTP_REVOKED', state.id, { bound: true }, { bound: false });
  });
  return c.json(200, { revoked: true });
}

// POST /api/blog-admin/step-up/revoke（保留原逻辑）
function revokeStepUpSession(c) {
  requireAdmin(c, false);
  var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  try {
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
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    apiError(503, 'ADMIN_CREDENTIAL_REVOKE_FAILED');
  }
  return c.json(200, { revoked: true });
}

// POST /api/blog-admin/local-recovery — 宿主机恢复码（loopback + PB admin token）
function requireLocalAdmin(c) {
  var admin = null;
  try { admin = c.get('admin') || null; } catch (_) {}
  if (!admin) apiError(401, 'AUTH_REQUIRED');
  requireLoopbackRealIp(c);
  return admin;
}

function revokeAllActivePages(txDao, collection, filter, params, revokedAt) {
  var count = 0;
  var page = 0;
  while (true) {
    var found = records(txDao, collection, filter, '+id', 50, params);
    if (!found.length) return count;
    for (var i = 0; i < found.length; i++) {
      found[i].set('revoked_at', revokedAt);
      txDao.saveRecord(found[i]);
      count++;
    }
    page++;
    if (page > 100) return count;
  }
}

function localRecovery(c) {
  var pbAdmin = requireLocalAdmin(c);
  var adminId = String(pbAdmin.id || '').trim();
  if (!adminId || HASH_SECRET.length < 32) apiError(503, 'ADMIN_RECOVERY_UNAVAILABLE');
  var adminReference = $security.hs256('admin-audit-actor:' + adminId, HASH_SECRET);
  var input = body(c);
  var email = String(input.email || '').trim().toLowerCase();
  if (!email || email.length > 320) apiError(400, 'INVALID_REQUEST');
  var recoveryCode = $security.randomStringWithAlphabet(43, REFERENCE_ALPHABET);
  var referenceId = $security.randomStringWithAlphabet(22, REFERENCE_ALPHABET);
  var expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  var result = null;

  $app.dao().runInTransaction(function (txDao) {
    var users = records(txDao, 'users', 'email = {:email}', '', 1, { email: email });
    if (!users.length) apiError(404, 'USER_NOT_FOUND');
    var user = users[0];
    if (user.getString('role') !== 'super_admin' || !user.verified()) apiError(403, 'AUTH_REQUIRED');
    var state = totpState(txDao, user.id);
    if (!isBound(state)) apiError(409, 'TOTP_NOT_BOUND');
    var now = new Date().toISOString();
    // 清除绑定 + 吊销全部会话
    state.set('secret_enc', '');
    state.set('secret_pending_enc', '');
    state.set('confirmed_at', '');
    state.set('revoked_at', now);
    var stepUpCount = revokeAllActivePages(txDao, 'admin_step_up_sessions', 'user = {:user} && revoked_at = null', { user: user.id }, now);
    var legacyCount = revokeAllActivePages(txDao, 'admin_verified_sessions', 'user = {:user} && revoked_at = null', { user: user.id }, now);
    state.set('recovery_nonce_hmac', recoveryCodeHmac(recoveryCode));
    state.set('recovery_expires_at', expiresAt);
    txDao.saveRecord(state);
    audits.writeSecurityAudit(txDao, {
      actorId: '',
      actorType: 'pb_admin',
      actorReference: adminReference,
      referenceId: referenceId,
      failAudit: header(c, 'X-Test-Fail-Audit') === '1',
    }, {
      actionCode: 'ADMIN_LOCAL_RECOVERY',
      targetType: 'user',
      targetId: user.id,
      before: { totpBound: true, activeStepUps: stepUpCount, activeLegacySessions: legacyCount },
      after: { totpBound: false, activeStepUps: 0, activeLegacySessions: 0, recoveryPending: true },
      version: 1,
      priority: 'high',
    });
    result = { stepUps: stepUpCount, legacySessions: legacyCount };
  });

  return c.json(200, {
    recoveryCode: recoveryCode,
    expiresAt: expiresAt,
    referenceId: referenceId,
    counts: result,
  });
}

module.exports = {
  isLoopbackAddress: isLoopbackAddress,
  stepUpStatus: stepUpStatus,
  totpSetup: totpSetup,
  totpConfirm: totpConfirm,
  totpVerify: totpVerify,
  totpRevoke: totpRevoke,
  revokeStepUpSession: revokeStepUpSession,
  localRecovery: localRecovery,
};
