/**
 * ============================================================================
 * STEP-UP 凭证算法 —— 镜像实现（MIRROR，非权威）
 * ============================================================================
 * 本文件中的 requireAdminStepUp 是 step-up HMAC 绑定校验算法的【镜像实现】。
 *
 * 权威实现（SOURCE OF TRUTH）：
 *   - admin-auth/src/step-up-policy.mjs （verifyStepUpCredential）
 *
 * 任何修改必须【先改 admin-auth 端权威实现】，再逐行同步到本文件，
 * 并核对共享常量清单：docs/step-up-shared-constants.md。
 * 禁止在本文件独立调整 namespace、拼接顺序、凭证格式、窗口值或比较方式。
 * 两端漂移 = 验证不一致 / 绕过路径（P0 安全风险）。
 * ============================================================================
 */
/**
 * ============================================================================
 * STEP-UP 凭证算法 —— 镜像实现（MIRROR，非权威）
 * ============================================================================
 * 本文件中的 requireAdminStepUp 是 step-up HMAC 绑定校验算法的【镜像实现】。
 *
 * 权威实现（SOURCE OF TRUTH）：
 *   - admin-auth/src/step-up-policy.mjs （verifyStepUpCredential）
 *
 * 任何修改必须【先改 admin-auth 端权威实现】，再逐行同步到本文件，
 * 并核对共享常量清单：docs/step-up-shared-constants.md。
 * 禁止在本文件独立调整 namespace、拼接顺序、凭证格式、窗口值或比较方式。
 * 两端漂移 = 验证不一致 / 绕过路径（P0 安全风险）。
 * ============================================================================
 */
'use strict';

var CREDENTIAL_PATTERN = /^v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/;
var ADMIN_ROLES = ['author', 'admin', 'super_admin'];
var REFERENCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var GUESTBOOK_COLLECTION = 'guestbook_messages';
var GALLERY_COLLECTION = 'gallery_items';
var PROTECTED_COLLECTIONS = [
  'posts', 'comments', 'tags', 'post_tags', 'users', 'friend_links',
  'announcements', 'media_assets', 'settings', 'post_versions',
  GUESTBOOK_COLLECTION, GALLERY_COLLECTION,
];
var SAFE_SELF_PROFILE_FIELDS = ['name', 'username', 'avatar'];
var ADMIN_MANAGED_COLLECTIONS = [
  'posts', 'comments', 'tags', 'users', 'friend_links',
  'announcements', 'media_assets',
  GUESTBOOK_COLLECTION, GALLERY_COLLECTION,
];

function forbidden(code) {
  var referenceId = $security.randomStringWithAlphabet(22, REFERENCE_ALPHABET);
  console.error('[admin-step-up-denied] reference=' + referenceId);
  throw new ForbiddenError(code || 'ADMIN_STEP_UP_REQUIRED');
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
  return require('./client_ip.js').clientIp(c);
}
function trustedAdminIp(ip) {
  var configured = String($os.getenv('ADMIN_IP') || '').split(/[\s,]+/).filter(Boolean);
  return !!ip && configured.indexOf(String(ip)) !== -1;
}


function hash(secret, namespace, value) {
  return $security.hs256(namespace + ':' + String(value), secret);
}

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return $security.equal(left, right);
}

function findBySelector(selector, dao) {
  var records = (dao || $app.dao()).findRecordsByFilter(
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
    if (options.requireSuperAdmin && role !== 'super_admin') forbidden();
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
    if (options.requireTrustedAdminIp && !trustedAdminIp(ip)) forbidden('ADMIN_NETWORK_DENIED');

    var hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    if (hashSecret.length < 32) forbidden();
    var record = findBySelector(selector, options.dao);
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
  } catch (caught) {
    if (caught && (caught.message === 'ADMIN_STEP_UP_REQUIRED' || caught.message === 'ADMIN_NETWORK_DENIED')) throw caught;
    forbidden();
  }
}

function requireProtectedWrite(e, operation) {
  var collection = '';
  try {
    collection = e.record && e.record.collection ? e.record.collection().name : '';
  } catch (_) {
    // e.record.collection() 在创建时可能失败，直接返回不拦截
    return;
  }
  if (PROTECTED_COLLECTIONS.indexOf(collection) === -1) return;

  var actor = currentActor(e);
  if (!actor) return;
  var role = String(actor.get('role') || '').trim();
  if (ADMIN_ROLES.indexOf(role) === -1) return;
  // 仅 admin / super_admin 强制 step-up（2FA）；author 的写操作豁免
  if (role === 'author') return;

  // posts 草稿豁免：写草稿（status != 'published'）不强制 step-up，
  // 只有正式发布/下架（status == 'published'）才要求 TOTP 二次验证。
  // 兼顾写作流畅性与"发布即公开"的核心防护。删除操作不在此豁免内。
  if ((operation === 'create' || operation === 'update') && collection === 'posts') {
    var postStatus = '';
    try {
      postStatus = String(e.record.get('status') || '').trim();
    } catch (_) {
      postStatus = '';
    }
    // 更新时还要考虑"旧状态是已发布、现在改为草稿"的下架场景——
    // 下架同样改变公开可见性，不豁免（要求 step-up）。
    var wasPublished = false;
    if (operation === 'update') {
      try {
        var storedPost = $app.dao().findRecordById('posts', e.record.id);
        wasPublished = String(storedPost.get('status') || '').trim() === 'published';
      } catch (_) {
        wasPublished = true; // 读不到旧状态时按敏感处理，fail closed
      }
    }
    var isPublished = postStatus === 'published';
    if (!isPublished && !wasPublished) return; // 纯草稿操作，豁免
    // 其余情况（发布新文 / 已发布文的任何修改 / 下架）继续走 step-up
  }

  if (operation === 'update' && collection === 'users' && e.record.id === actor.id) {
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

function auditRoleOf(record) {
  if (!record || typeof record.get !== 'function') return '';
  return String(record.get('role') || '').trim();
}

function actingPrincipal(e) {
  var user = currentActor(e);
  if (user) {
    return { actorId: user.id, role: auditRoleOf(user) };
  }

  var context = requestContext(e);
  var info = null;
  try { info = $apis.requestInfo(context); } catch (_) {}
  var admin = info && info.admin ? info.admin : null;
  try { admin = admin || (context && context.get('admin')) || null; } catch (_) {}
  if (!admin) return null;

  var secret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
  var adminId = String(
    admin.id || (typeof admin.getId === 'function' ? admin.getId() : ''),
  ).trim();
  if (secret.length < 32 || !adminId) return null;
  return {
    actorId: 'pb_admin:' + $security.hs256('admin-audit-actor:' + adminId, secret),
    role: 'pb_admin',
  };
}

function redactAuditIp(ip) {
  var value = String(ip || '').trim();
  if (!value) return 'unknown';
  var parts = value.split('.');
  if (parts.length === 4) return parts[0] + '.' + parts[1] + '.*.*';

  var secret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
  if (secret.length < 32) return 'unknown';
  return 'hmac:' + $security.hs256('admin-audit-ip:' + value, secret).slice(0, 16);
}

function auditRecordLabel(collection, record) {
  if (!record) return '';
  if (collection === GUESTBOOK_COLLECTION) return record.id;
  if (collection === GALLERY_COLLECTION) {
    return String(record.get('title') || record.id).slice(0, 100);
  }
  if (collection === 'posts') return String(record.get('title') || record.id);
  if (collection === 'tags') return String(record.get('name') || record.id);
  if (collection === 'users') {
    return String(record.get('name') || record.get('email') || record.id);
  }
  if (collection === 'comments') {
    return String(record.get('content') || '').slice(0, 60) || record.id;
  }
  if (collection === 'friend_links') return String(record.get('name') || record.id);
  if (collection === 'announcements') {
    return String(record.get('title') || record.get('content') || '').slice(0, 60) || record.id;
  }
  if (collection === 'media_assets') {
    return String(record.get('alt') || record.get('file') || record.id);
  }
  return record.id;
}

function auditManagedWrite(e, action) {
  try {
    var collection = e.record && e.record.collection ? e.record.collection().name : '';
    if (ADMIN_MANAGED_COLLECTIONS.indexOf(collection) === -1) return;

    var principal = actingPrincipal(e);
    if (!principal) return;

    var recordId = e.record ? e.record.id : '';
    var label = auditRecordLabel(collection, e.record);
    var summary = String(action) + ' ' + collection + ': ' + label;
    var auditCollection = $app.dao().findCollectionByNameOrId('audit_logs');
    var audit = new Record(auditCollection);
    audit.set('actor', principal.actorId);
    audit.set('action', String(action) + '_' + collection);
    audit.set('target_collection', collection);
    audit.set('target_id', recordId);
    audit.set('summary', ('[' + principal.role + '] ' + summary).slice(0, 500));
    audit.set('ip', redactAuditIp(clientIp(e)));
    audit.set('user_agent', header(e, 'User-Agent').slice(0, 500));
    $app.dao().saveRecord(audit);
  } catch (_) {
    console.error('[audit-write-failed] operation=write result=INTERNAL_ERROR');
  }
}

module.exports = {
  requireAdminStepUp: requireAdminStepUp,
  requireProtectedWrite: requireProtectedWrite,
  auditManagedWrite: auditManagedWrite,
};
