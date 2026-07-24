(function () {
/// <reference path="../pb_data/types.d.ts" />

// Audit logging hook — records create/update/delete events for admin-managed
// collections into the `audit_logs` collection. audit_logs has createRule=null
// (server-only), so this hook is the only writer besides admin_webauthn.pb.js.
//
// Goal: every admin CRUD action through the JS SDK gets an audit trail
// (who / what / when / from-where) without each React component having to
// remember to log. The React AuditLogViewer reads these back.

const ADMIN_MANAGED_COLLECTIONS = [
  'posts',
  'comments',
  'tags',
  'users',
  'friend_links',
  'announcements',
  'media_assets',
];

// Skip logging when the acting user is unknown (e.g. anonymous public comment
// create, or server-internal seeds). Public comment creation is already
// validated/logged by validate_comment.pb.js; we only care about authed admin
// mutations here.
function actingUser(e) {
  if (e && e.auth) return e.auth;
  try {
    if (typeof $apis !== 'undefined' && e.httpContext) {
      const info = $apis.requestInfo(e.httpContext);
      return info.auth || info.authRecord || null;
    }
  } catch (_) {}
  try {
    return (e.httpContext && (e.httpContext.get('authRecord') || e.httpContext.get('auth'))) || null;
  } catch (_) {
    return null;
  }
}

function roleOf(record) {
  if (!record || typeof record.get !== 'function') return '';
  return String(record.get('role') || '').trim();
}

function redactIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  const parts = String(ip).split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  // IPv6 or odd format — hash a truncated form
  try {
    return $security.sha256(ip).slice(0, 16);
  } catch (_) {
    return 'unknown';
  }
}

function getClientIP(e) {
  try {
    const info = $apis.requestInfo(e.httpContext);
    return (info.clientIp || 'unknown').trim();
  } catch (_) {
    return 'unknown';
  }
}

function getUserAgent(e) {
  try {
    const info = $apis.requestInfo(e.httpContext);
    return String(info.headers['user-agent'] || '').slice(0, 500);
  } catch (_) {
    return '';
  }
}

function recordLabel(collection, record) {
  if (!record) return '';
  try {
    if (collection === 'posts') return String(record.get('title') || record.id);
    if (collection === 'tags') return String(record.get('name') || record.id);
    if (collection === 'users') return String(record.get('name') || record.get('email') || record.id);
    if (collection === 'comments') return String(record.get('content') || '').slice(0, 60) || record.id;
    if (collection === 'friend_links') return String(record.get('name') || record.id);
    if (collection === 'announcements') return String(record.get('title') || record.get('content') || '').slice(0, 60) || record.id;
    if (collection === 'media_assets') return String(record.get('alt') || record.get('file') || record.id);
  } catch (_) {}
  return record.id;
}

function writeAudit({ actorId, actorRole, action, collection, recordId, summary, ip, ua }) {
  try {
    const col = $app.dao().findCollectionByNameOrId('audit_logs');
    const rec = new Record(col);
    rec.set('actor', actorId || 'anonymous');
    rec.set('action', action);
    rec.set('target_collection', collection || '');
    rec.set('target_id', recordId || '');
    rec.set('summary', String(summary || '').slice(0, 500));
    rec.set('ip', redactIp(ip));
    rec.set('user_agent', ua || '');
    // actor role is not a column in audit_logs schema; fold it into summary for context
    if (actorRole) {
      rec.set('summary', `[${actorRole}] ${summary || ''}`.slice(0, 500));
    }
    $app.dao().saveRecord(rec);
  } catch (err) {
    // Never let audit logging break the actual operation, but surface the
    // failure with a clear marker so a broken audit trail is detectable.
    console.error('[audit-write-failed]', JSON.stringify({
      action, collection, recordId, error: String(err && err.message || err),
    }));
  }
}

function logEvent(e, action) {
  const collection = e.record && e.record.collection ? e.record.collection().name : '';
  if (ADMIN_MANAGED_COLLECTIONS.indexOf(collection) === -1) return;

  const user = actingUser(e);
  // Only log authenticated mutations. Anonymous public comment creation is
  // handled elsewhere; skip to avoid noise + potential abuse of audit storage.
  if (!user) return;

  const role = roleOf(user);
  // Readers shouldn't be mutating these collections via API anyway (rules
  // forbid it), but guard against log spam from self-profile edits etc.
  // We still log reader actions for visibility — they'll be rejected by rules
  // but if somehow allowed, we want the trail.

  const recordId = e.record ? e.record.id : '';
  const label = recordLabel(collection, e.record);
  const ip = getClientIP(e);
  const ua = getUserAgent(e);

  writeAudit({
    actorId: user.id,
    actorRole: role,
    action: `${action}_${collection}`,
    collection,
    recordId,
    summary: `${action} ${collection}: ${label}`,
    ip,
    ua,
  });
}

onRecordAfterCreateRequest((e) => logEvent(e, 'create'));
onRecordAfterUpdateRequest((e) => logEvent(e, 'update'));
onRecordAfterDeleteRequest((e) => logEvent(e, 'delete'));
})();
