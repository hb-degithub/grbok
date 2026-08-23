/// <reference path="../pb_data/types.d.ts" />
// ESA 缓存刷新管理端（仅 super_admin）：薄路由，业务逻辑在 lib/cache_admin.js
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重 eval，
// 访问不到本 IIFE 的闭包变量，因此错误映射 helper 在 lib/cache_admin_helpers.js，
// handler 内 require 调用。
(function () {
  routerAdd('GET', '/api/blog-admin/esa/config', function (c) {
    return require(__hooks + '/lib/cache_admin.js').configRead(c);
  });

  routerAdd('PUT', '/api/blog-admin/esa/config', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').configSave(c);
    } catch (error) {
      return require(__hooks + '/lib/cache_admin_helpers.js').failure(c, error);
    }
  }, $apis.bodyLimit(65536));

  routerAdd('POST', '/api/blog-admin/esa/purge', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').purge(c);
    } catch (error) {
      return require(__hooks + '/lib/cache_admin_helpers.js').failure(c, error);
    }
  }, $apis.bodyLimit(65536));

  routerAdd('GET', '/api/blog-admin/esa/tasks', function (c) {
    try {
      return require(__hooks + '/lib/cache_admin.js').tasks(c);
    } catch (error) {
      return require(__hooks + '/lib/cache_admin_helpers.js').failure(c, error);
    }
  });
})();
