(function () {
/// <reference path="../pb_data/types.d.ts" />

// 文章点赞、收藏端点（2026-10-14 安全加固）
//
// 语义变更：点赞/收藏不再是匿名可用的 toggle。
//   POST   /api/posts/:id/like      — 点赞（需登录，幂等）
//   DELETE /api/posts/:id/like      — 取消点赞（需登录，计数 -1 且不为负）
//   POST   /api/posts/:id/bookmark  — 收藏（需登录，幂等）
//   DELETE /api/posts/:id/bookmark  — 取消收藏（需登录）
// 兼容：POST /bookmark 保留（不再切换为「取消收藏」，仅保证已收藏状态）。
//
// 注意：PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime
// 里重新 eval，访问不到本 IIFE 的闭包变量，因此 handler 必须自包含。

routerAdd('POST', '/api/posts/:id/like', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').likePost(e);
}, $apis.bodyLimit(4096));

routerAdd('DELETE', '/api/posts/:id/like', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').unlikePost(e);
});

routerAdd('POST', '/api/posts/:id/bookmark', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').bookmarkPost(e);
}, $apis.bodyLimit(4096));

routerAdd('DELETE', '/api/posts/:id/bookmark', function (e) {
  return require(__hooks + '/lib/post_actions_lib.js').unbookmarkPost(e);
});
})();
