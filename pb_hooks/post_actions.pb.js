(function () {
/// <reference path="../pb_data/types.d.ts" />

// 文章点赞、收藏端点
// 注意：PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime
// 里重新 eval，访问不到本 IIFE 的闭包变量，因此 handler 必须自包含。

routerAdd('POST', '/api/posts/:id/like', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').likePost(e);
}, $apis.bodyLimit(4096));

routerAdd('POST', '/api/posts/:id/bookmark', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').toggleBookmark(e);
}, $apis.bodyLimit(4096));
})();
