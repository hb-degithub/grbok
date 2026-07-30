/// <reference path="../pb_data/types.d.ts" />
// ESA 缓存刷新管理端（仅 super_admin）：薄路由，业务逻辑在 lib/cache_admin.js
(function () {
  function failure(c, error) {
    var code = String(error && error.code || 'INTERNAL_ERROR');
    if (code === 'INVALID_PURGE_URL' || code === 'ESA_CONFIG_INVALID') return c.json(400, { code: code });
    if (code === 'ESA_PURGE_RATE_LIMITED') return c.json(429, { code: code, retryAfter: Number(error.retryAfter || 1) });
    if (code === 'ESA_PAYLOAD_INVALID' || code === 'ESA_INVALID_URL') return c.json(400, { code: code });
    if (code === 'ESA_RATE_LIMITED') return c.json(429, { code: code });
    if (code === 'ESA_NOT_CONFIGURED' || code === 'ESA_QUOTA_EXCEEDED' || code === 'ESA_UPSTREAM_ERROR' || code === 'ESA_UNAVAILABLE') {
      return c.json(Number(error.statusCode) || 503, { code: code });
    }
    throw error;
  }

  routerAdd('GET', '/api/blog-admin/esa/config', function (c) {
    return require(__hooks + '/lib/cache_admin.js').configRead(c);
  });

  routerAdd('PUT', '/api/blog-admin/esa/config', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').configSave(c);
    } catch (error) {
      return failure(c, error);
    }
  }, $apis.bodyLimit(65536));

  routerAdd('POST', '/api/blog-admin/esa/purge', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').purge(c);
    } catch (error) {
      return failure(c, error);
    }
  }, $apis.bodyLimit(65536));

  routerAdd('GET', '/api/blog-admin/esa/tasks', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').tasks(c);
    } catch (error) {
      return failure(c, error);
    }
  });
})();
