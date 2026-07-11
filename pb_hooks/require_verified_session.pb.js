(function () {
/// <reference path="../pb_data/types.d.ts" />

// Server-side passkey enforcement layer.
//
// The `posts`/`comments`/`tags`/`users`/`friend_links`/`announcements`/
// `media_assets`/`settings`/`admin_passkeys` collection API rules only check
// `@request.auth.role`. Without this hook, anyone holding an admin's PocketBase
// auth token (cookie theft / XSS / internal network) can skip the passkey
// second factor entirely and write to those collections via the standard API.
//
// This hook closes that hole: before any create/update/delete on an
// admin-managed collection by an author/admin/super_admin, we require that a
// live (non-revoked, non-expired) `admin_verified_sessions` record exists for
// the acting user. Such a record is created ONLY by the WebAuthn verify flow
// in admin_webauthn.pb.js, so a stolen token alone cannot satisfy it.
//
// We intentionally do NOT re-check the token/fingerprint hashes here:
//  - The PocketBase auth token rotates on authRefresh(), so binding to the
//    exact token would break legitimate admin CRUD after the first refresh.
//  - admin-capable CRUD requests do not carry X-Browser-Fingerprint (only the
//    passkey/login flows do), so a 4-factor re-check would reject all writes.
// Record existence + expiry + non-revocation is the correct, sufficient gate.
//
// reader role is never admin-capable and is never subject to this gate.
// `comments` public creation is anonymous (no auth) and is handled by
// validate_comment.pb.js; this hook only fires for authed admin-capable writes
// on `comments` (status moderation etc.), which is correct.

const ADMIN_CAPABLE_ROLES = ['author', 'admin', 'super_admin'];

// Collections whose writes require a verified admin session. Mirrors the
// admin-managed set from audit_admin_actions.pb.js plus admin_passkeys.
const PROTECTED_COLLECTIONS = [
  'posts',
  'comments',
  'tags',
  'post_tags',
  'users',
  'friend_links',
  'announcements',
  'media_assets',
  'settings',
  'admin_passkeys',
];

function roleOf(record) {
  if (!record || typeof record.get !== 'function') return '';
  return String(record.get('role') || '').trim();
}

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

// Look up whether the given user has a live verified session.
// Returns true only if a non-revoked, non-expired record exists.
function hasLiveVerifiedSession(userId) {
  if (!userId || !/^[a-zA-Z0-9]{15}$/.test(userId)) return false;
  const now = new Date().toISOString();
  const filter = "user = {:userId} && revoked_at = null && expires_at > {:now}";
  try {
    let records;
    if ($app.findRecordsByFilter) {
      records = $app.findRecordsByFilter('admin_verified_sessions', filter, '-expires_at', 1, 0, { userId, now });
    } else {
      records = $app.dao().findRecordsByFilter('admin_verified_sessions', filter, '-expires_at', 1, 0, { userId, now });
    }
    return records && records.length > 0;
  } catch (_) {
    // Collection missing or query error — fail closed.
    return false;
  }
}

// For the `users` collection we only gate management of OTHER users. A
// super_admin editing their own profile (name, email) or confirming email
// verification must not be forced through passkey each time — the rule
// already restricts self-edits to `id = @request.auth.id`, and the dangerous
// operations (role escalation on another user, deleting another user) always
// have `record.id !== user.id`. Self-edits are exempt; everything else on
// `users` by an admin-capable role still requires a verified session.
function isSelfUsersEdit(collection, e, user) {
  if (collection !== 'users') return false;
  if (!user || !e.record) return false;
  return e.record.id === user.id;
}

function requireVerifiedSession(e) {
  const collection = (e.record && typeof e.record.collection === 'function') ? e.record.collection().name : '';
  if (PROTECTED_COLLECTIONS.indexOf(collection) === -1) return;

  const user = actingUser(e);
  if (!user) return; // anonymous request — rules/other hooks handle it
  const role = roleOf(user);
  if (ADMIN_CAPABLE_ROLES.indexOf(role) === -1) return; // reader: not gated here

  if (isSelfUsersEdit(collection, e, user)) return;

  if (!hasLiveVerifiedSession(user.id)) {
    throw new ForbiddenError('需要完成 Passkey 二次验证后才能执行此操作');
  }
}

onRecordBeforeCreateRequest((e) => requireVerifiedSession(e));
onRecordBeforeUpdateRequest((e) => requireVerifiedSession(e));
onRecordBeforeDeleteRequest((e) => requireVerifiedSession(e));
})();
