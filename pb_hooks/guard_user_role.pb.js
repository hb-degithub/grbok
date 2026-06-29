const USER_ROLES = ['reader', 'author', 'admin', 'super_admin'];

function next(e) {
  if (typeof e.next === 'function') e.next();
}

function roleOf(record) {
  if (!record || typeof record.get !== 'function') return '';
  return String(record.get('role') || '').trim();
}

function getRequestAuth(e) {
  if (e.auth) return e.auth;

  try {
    if (typeof $apis !== 'undefined' && e.httpContext) {
      const info = $apis.requestInfo(e.httpContext);
      return info.auth || info.authRecord || null;
    }
  } catch (_) {}

  try {
    return e.httpContext?.get?.('authRecord') || e.httpContext?.get?.('auth') || null;
  } catch (_) {
    return null;
  }
}

function isSuperAdmin(e) {
  return roleOf(getRequestAuth(e)) === 'super_admin';
}

function assertValidRole(role) {
  if (USER_ROLES.indexOf(role) === -1) {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }
}

function storedUserRole(id) {
  if (!id) return '';
  try {
    return roleOf($app.dao().findRecordById('users', id));
  } catch (_) {
    return '';
  }
}

onRecordBeforeCreateRequest((e) => {
  const requestedRole = roleOf(e.record) || 'reader';

  if (!isSuperAdmin(e) && requestedRole !== 'reader') {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }

  assertValidRole(requestedRole);
  e.record.set('role', isSuperAdmin(e) ? requestedRole : 'reader');
  next(e);
}, 'users');

onRecordBeforeUpdateRequest((e) => {
  const oldRole = storedUserRole(e.record.id);
  const requestedRole = roleOf(e.record) || oldRole || 'reader';

  assertValidRole(requestedRole);

  if (oldRole && requestedRole !== oldRole && !isSuperAdmin(e)) {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }

  e.record.set('role', requestedRole);
  next(e);
}, 'users');
