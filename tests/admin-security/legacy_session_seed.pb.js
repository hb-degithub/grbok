/// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

routerAdd('POST', '/api/test/admin-step-up/seed-legacy', function (c) {
  var suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  var users = $app.dao().findCollectionByNameOrId('users');
  var user = new Record(users);
  user.set('email', 'legacy_' + suffix + '@example.local');
  user.set('username', 'legacy_' + suffix);
  user.set('password', 'Test12345!');
  user.set('passwordConfirm', 'Test12345!');
  user.set('role', 'super_admin');
  user.set('verified', true);
  user.refreshTokenKey();
  $app.dao().saveRecord(user);

  var sessions = $app.dao().findCollectionByNameOrId('admin_verified_sessions');
  var session = new Record(sessions);
  session.set('user', user.id);
  session.set('token_hash', '0'.repeat(64));
  session.set('fingerprint_hash', '0'.repeat(64));
  session.set('ip_hash', '0'.repeat(64));
  session.set('user_agent_hash', '0'.repeat(64));
  session.set('verified_at', new Date().toISOString());
  session.set('expires_at', new Date(Date.now() + 15 * 60 * 1000).toISOString());
  session.set('revoked_at', '');
  $app.dao().saveRecord(session);
  return c.json(200, { seeded: 1 });
});
