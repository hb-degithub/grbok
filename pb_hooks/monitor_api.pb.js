(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 监控查询端点:
  //   GET /api/public/ping             — 204 心跳,供前台实测用户→服务器延迟
  //   GET /api/public/status           — 公开聚合状态(脱敏,10s 缓存)
  //   GET /api/blog-admin/monitor/summary — 后台汇总(admin/super_admin)
  //   GET /api/blog-admin/monitor/series  — 后台时间序列与失败明细(admin/super_admin)
  // 逻辑全在 lib/monitor_lib.js(JSVM 回调闭包陷阱,壳内 require)。

  routerAdd('GET', '/api/public/ping', function (e) {
    return e.json(200, { pong: true });
  }, $apis.bodyLimit(1024));

  routerAdd('GET', '/api/public/status', function (e) {
    return require(__hooks + '/lib/monitor_lib.js').getPublicStatus(e);
  }, $apis.bodyLimit(1024));

  routerAdd('GET', '/api/blog-admin/monitor/summary', function (e) {
    return require(__hooks + '/lib/monitor_lib.js').getAdminSummary(e);
  }, $apis.bodyLimit(4096));

  routerAdd('GET', '/api/blog-admin/monitor/series', function (e) {
    return require(__hooks + '/lib/monitor_lib.js').getAdminSeries(e);
  }, $apis.bodyLimit(4096));

  routerAdd('GET', '/api/blog-admin/monitor/host', function (e) {
    return require(__hooks + '/lib/monitor_lib.js').getAdminHostSeries(e);
  }, $apis.bodyLimit(4096));

  // 宿主机性能上报:仅宿主机 cron 调用(回环 + X-Internal-Secret 双重校验)
  routerAdd('POST', '/api/internal/monitor/host', function (e) {
    return require(__hooks + '/lib/monitor_lib.js').saveHostMetrics(e);
  }, $apis.bodyLimit(4096));


  // 防护统计:雷池采集器写入(内网+密钥)/ 公开聚合(脱敏)/ 后台明细
  routerAdd('POST', '/api/internal/monitor/protection', function (e) {
    return require(__hooks + '/lib/protection' + '_lib.js').saveSnapshot(e);
  }, $apis.bodyLimit(4096));

  routerAdd('GET', '/api/public/protection', function (e) {
    return require(__hooks + '/lib/protection' + '_lib.js').getPublicProtection(e);
  }, $apis.bodyLimit(1024));

  routerAdd('GET', '/api/blog-admin/monitor/protection', function (e) {
    return require(__hooks + '/lib/protection' + '_lib.js').getAdminProtection(e);
  }, $apis.bodyLimit(4096));
})();
