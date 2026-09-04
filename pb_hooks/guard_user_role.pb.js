(function () {
// 用户角色守卫：创建/更新/删除 users 记录时强制角色合法性，
// 并防止最后一位 super_admin 被降级或删除。
//
// 实现说明（2026-08-31）：早期版本曾出现 users 写操作 400，当时归因为
// "onRecord*Request handler 访问不到 IIFE 闭包"，现未能复现该论断（goja 中
// 闭包可正常捕获外层作用域），原始根因未确证。保守起见保留各 handler 自包含
// 结构（辅助函数在 handler 体内定义），仅依赖 $app / $apis / BadRequestError
// 等全局，避免再次踩坑。

onRecordBeforeCreateRequest((e) => {
  const USER_ROLES = ['reader', 'author', 'admin', 'super_admin'];

  const roleOf = (record) => {
    if (!record || typeof record.get !== 'function') return '';
    return String(record.get('role') || '').trim();
  };

  const getRequestAuth = () => {
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
  };

  const isSuperAdmin = roleOf(getRequestAuth()) === 'super_admin';
  const requestedRole = roleOf(e.record) || 'reader';

  if (!isSuperAdmin && requestedRole !== 'reader') {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }
  if (USER_ROLES.indexOf(requestedRole) === -1) {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }

  e.record.set('role', isSuperAdmin ? requestedRole : 'reader');
  if (typeof e.next === 'function') e.next();
}, 'users');

onRecordBeforeUpdateRequest((e) => {
  const USER_ROLES = ['reader', 'author', 'admin', 'super_admin'];

  const roleOf = (record) => {
    if (!record || typeof record.get !== 'function') return '';
    return String(record.get('role') || '').trim();
  };

  const getRequestAuth = () => {
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
  };

  const storedUserRole = (id) => {
    if (!id) return '';
    try {
      return roleOf($app.dao().findRecordById('users', id));
    } catch (_) {
      return '';
    }
  };

  // Count current super_admin users. Used to prevent the last super_admin from
  // being demoted or deleted, which would lock everyone out of full admin.
  const superAdminCount = () => {
    try {
      if ($app.findRecordsByFilter) {
        return $app.findRecordsByFilter('users', 'role = "super_admin"').length;
      }
      return $app.dao().findRecordsByFilter('users', 'role = "super_admin"').length;
    } catch (_) {
      return 0; // fail closed — treat as "cannot confirm a super_admin exists"
    }
  };

  const isSuperAdmin = roleOf(getRequestAuth()) === 'super_admin';
  const oldRole = storedUserRole(e.record.id);
  if (!oldRole) {
    // 旧角色读取失败（DB 瞬时错误等）时 fail closed：
    // 否则未认证请求可在 oldRole==='' 时绕过下方 role 变更校验，写入任意合法 role。
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }
  const requestedRole = roleOf(e.record) || oldRole;

  if (USER_ROLES.indexOf(requestedRole) === -1) {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }
  if (requestedRole !== oldRole && !isSuperAdmin) {
    throw new BadRequestError('Invalid or unauthorized user role change.');
  }

  // Prevent demoting the last super_admin. This is a server-side guarantee
  // independent of the frontend UserManager guard.
  if (oldRole === 'super_admin' && requestedRole !== 'super_admin' && superAdminCount() <= 1) {
    throw new BadRequestError('无法降级最后一位超级管理员，请先提升其他用户为超级管理员。');
  }

  e.record.set('role', requestedRole);
  if (typeof e.next === 'function') e.next();
}, 'users');

// Prevent deleting the last super_admin.
onRecordBeforeDeleteRequest((e) => {
  const roleOf = (record) => {
    if (!record || typeof record.get !== 'function') return '';
    return String(record.get('role') || '').trim();
  };

  const storedUserRole = (id) => {
    if (!id) return '';
    try {
      return roleOf($app.dao().findRecordById('users', id));
    } catch (_) {
      return '';
    }
  };

  const superAdminCount = () => {
    try {
      if ($app.findRecordsByFilter) {
        return $app.findRecordsByFilter('users', 'role = "super_admin"').length;
      }
      return $app.dao().findRecordsByFilter('users', 'role = "super_admin"').length;
    } catch (_) {
      return 0; // fail closed — treat as "cannot confirm a super_admin exists"
    }
  };

  const oldRole = storedUserRole(e.record.id);
  if (oldRole === 'super_admin' && superAdminCount() <= 1) {
    throw new BadRequestError('无法删除最后一位超级管理员，请先提升其他用户为超级管理员。');
  }
  if (typeof e.next === 'function') e.next();
}, 'users');
})();
