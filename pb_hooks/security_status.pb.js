(function () {
/// <reference path="../pb_data/types.d.ts" />

// 安全防护状态查询端点（仅管理员可用）
// 返回各防护模块的当前状态、限流统计、最近安全事件

routerAdd('GET', '/api/blog-admin/security/status', function (e) {
  return require(__hooks + '/lib/security_status_lib.js').getSecurityStatus(e);
}, $apis.bodyLimit(4096));

routerAdd('GET', '/api/blog-admin/security/events', function (e) {
  return require(__hooks + '/lib/security_status_lib.js').getSecurityEvents(e);
}, $apis.bodyLimit(4096));
})();
