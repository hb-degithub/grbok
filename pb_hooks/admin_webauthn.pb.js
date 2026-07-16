/// <reference path="../pb_data/types.d.ts" />

// Passkey registration, assertion, step-up issuance and management live in
// admin_security.pb.js. This compatibility endpoint remains for the existing
// email-verification gate while the frontend adopts the dedicated APIs.
routerAdd('GET', '/api/blog-admin/email-verification-status', function (c) {
  var user = c.get('authRecord') || null;
  var role = user ? String(user.get('role') || '').trim() : '';
  if (!user || ['author', 'admin', 'super_admin'].indexOf(role) === -1) {
    throw new UnauthorizedError('AUTH_REQUIRED');
  }
  return c.json(200, { emailVerified: !!user.verified(), email: user.getString('email') || '' });
});
