/// <reference path="../pb_data/types.d.ts" />

(function () {
  // 2026-11-16 渗透测试 #23：/api/blog-admin/* 未认证时不再暴露端点存在性。
  //
  // 修复前匿名访问已存在端点 → 403 ADMIN_STEP_UP_REQUIRED，访问不存在的
  // /api/blog-admin/xxx → 404，可据状态码枚举 20+ 个管理端点。
  //
  // 现策略（在 step-up 判定之前）：
  //   1. 未携带任何有效身份（users authRecord 或原生 admin）→ 401 AUTH_REQUIRED，
  //      与具体端点无关；
  //   2. 已认证但无 step-up 的请求继续进入原 handler，维持 403
  //      ADMIN_STEP_UP_REQUIRED 语义；
  //   3. 未注册路径也返回同样的 401：routerUse 中间件 + 前缀 catch-all 双保险。
  //
  // PB 0.22.48 实测（真实隔离实例）：
  //   - routerUse 在已注册路由和 PB 内置 /api/* 兜底路由上都会执行；未命中时
  //     c.path() 是 "/api/*"，因此判断原始路径必须读 c.request().url.path。
  //   - 认证中间件早于 routerUse，中间件内 c.get('authRecord') / c.get('admin')
  //     已可用（实测 authorization 请求 authRecord=yes）。
  //   - Echo 对未注册的 OPTIONS 自动回 204 且不进入中间件；已知/未知路径一致，
  //     不构成枚举差异，无需额外处理。
  //   - 前缀 catch-all 不遮蔽既有静态路由（实测 /api/blog-admin/mail/overview
  //     仍命中真实 handler）；它只兜住未注册路径。
  //
  // 注意：routerUse / routerAdd 回调按源码在请求级 runtime 重新 eval，看不到
  // 本 IIFE 的常量与函数，所以逻辑必须在每个回调内部自包含。

  routerUse(function (next) {
    return function (c) {
      var raw = '';
      try { raw = String(c.request().url.path || ''); } catch (_) { raw = ''; }
      var prefixed = raw === '/api/blog-admin' || raw.indexOf('/api/blog-admin/') === 0;
      if (prefixed) {
        var authenticated = false;
        try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
        if (!authenticated) {
          try { if (c.get('admin')) authenticated = true; } catch (_) {}
        }
        if (!authenticated) {
          return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
        }
      }
      return next(c);
    };
  });

  // 前缀 catch-all：未注册路径的兜底。静态路由优先，不会影响既有端点。
  routerAdd('GET', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });

  routerAdd('POST', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });

  routerAdd('PUT', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });

  routerAdd('PATCH', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });

  routerAdd('DELETE', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });

  routerAdd('HEAD', '/api/blog-admin/*', function (c) {
    var authenticated = false;
    try { if (c.get('authRecord')) authenticated = true; } catch (_) {}
    if (!authenticated) {
      try { if (c.get('admin')) authenticated = true; } catch (_) {}
    }
    if (!authenticated) {
      return c.json(401, { code: 401, message: 'AUTH_REQUIRED.', data: {} });
    }
    return c.json(404, { code: 404, message: 'Not Found.', data: {} });
  });
})();
