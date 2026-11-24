(function () {
/// <reference path="../pb_data/types.d.ts" />

// 公开互动聚合：GET /api/post-engagement?limit=50
//
// 为什么需要它：`reactions` 集合的 API 规则已全部置空（仅服务端可读），
// 匿名/读者直连 /api/collections/reactions/records 恒 403，数据洞察看板因此
// 拿不到互动数据。本端点把「浏览 + 反应 + 评论」的统计收回服务端，
// 用 DAO 侧聚合取数，完全不依赖集合读规则（见 lib/post_engagement.js）。
//
// 公开、无鉴权；响应头 Cache-Control: public, max-age=30（可由 CDN 缓存 30s）。
// PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime 重新 eval，
// 访问不到本 IIFE 闭包，因此 handler 内 require。

routerAdd('GET', '/api/post-engagement', function (c) {
  return require(__hooks + '/lib/post_engagement.js').list(c);
});

})();
