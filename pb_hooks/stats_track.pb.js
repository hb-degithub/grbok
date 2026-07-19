(function () {
/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 访问统计：track-view 采集 + blog-stats 聚合 + 每日清理 90 天前数据。
// 隐私：不存原始 IP，visitor_hash 使用服务端 HMAC 并按日轮换；
// 任何端点都不返回 visitor_hash 或单条记录，只出聚合数字。
//
// 注意：PB 0.22 JSVM 的 routerAdd/cronAdd 回调按源码字符串在请求级 runtime
// 里重新 eval，访问不到本 IIFE 的闭包变量，因此 handler 必须自包含 ——
// 全部逻辑在 pb_hooks/lib/stats_lib.js，回调内 require（与 blog_auth.pb.js 一致）。

routerAdd('POST', '/api/track-view', function (e) {
  return require(__hooks + '/lib/stats_lib.js').trackView(e);
}, $apis.bodyLimit(4096));

routerAdd('GET', '/api/blog-stats', function (e) {
  return require(__hooks + '/lib/stats_lib.js').blogStats(e);
}, $apis.bodyLimit(4096));

routerAdd('GET', '/api/friend-link-stats', function (e) {
  return require(__hooks + '/lib/stats_lib.js').friendLinkStats(e);
});

cronAdd('page-views-retention-cleanup', '17 3 * * *', function () {
  require(__hooks + '/lib/stats_lib.js').retentionCleanup();
});
})();
