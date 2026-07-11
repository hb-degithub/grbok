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

// Count current super_admin users. Used to prevent the last super_admin from
// being demoted or deleted, which would lock everyone out of full admin.
function superAdminCount() {
  try {
    if ($app.findRecordsByFilter) {
      return $app.findRecordsByFilter('users', 'role = "super_admin"').length;
    }
    return $app.dao().findRecordsByFilter('users', 'role = "super_admin"').length;
  } catch (_) {
    return 0; // fail closed — treat as "cannot confirm a super_admin exists"
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

  // Prevent demoting the last super_admin. This is a server-side guarantee
  // independent of the frontend UserManager guard.
  if (oldRole === 'super_admin' && requestedRole !== 'super_admin' && superAdminCount() <= 1) {
    throw new BadRequestError('无法降级最后一位超级管理员，请先提升其他用户为超级管理员。');
  }

  e.record.set('role', requestedRole);
  next(e);
}, 'users');

// Prevent deleting the last super_admin.
onRecordBeforeDeleteRequest((e) => {
  const oldRole = storedUserRole(e.record.id);
  if (oldRole === 'super_admin' && superAdminCount() <= 1) {
    throw new BadRequestError('无法删除最后一位超级管理员，请先提升其他用户为超级管理员。');
  }
  next(e);
}, 'users');
