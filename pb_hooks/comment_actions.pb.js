(function () {
/// <reference path="../pb_data/types.d.ts" />

// 评论点赞、编辑、删除端点
// 注意：PB 0.22 JSVM 的 routerAdd 回调按源码字符串在请求级 runtime
// 里重新 eval，访问不到本 IIFE 的闭包变量，因此 handler 必须自包含。

routerAdd('POST', '/api/comments/:id/like', function (e) {
  return require(__hooks + '/lib/comment_actions_lib.js').likeComment(e);
}, $apis.bodyLimit(4096));

routerAdd('POST', '/api/comments/:id/edit', function (e) {
  return require(__hooks + '/lib/comment_actions_lib.js').editComment(e);
}, $apis.bodyLimit(4096));

routerAdd('POST', '/api/comments/:id/delete', function (e) {
  return require(__hooks + '/lib/comment_actions_lib.js').deleteComment(e);
}, $apis.bodyLimit(4096));

routerAdd('POST', '/api/comments/verification/send', function (e) {
  return require(__hooks + '/lib/comment_actions_lib.js').sendVerification(e);
}, $apis.bodyLimit(4096));
})();
