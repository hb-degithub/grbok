(function () {
/// <reference path="../pb_data/types.d.ts" />

// 用户等级自动升级机制（薄注册层）
// PB 0.22 JSVM 的 onRecord* 回调按源码字符串在请求级 runtime 重新 eval，
// 访问不到本 IIFE 的闭包变量，全部业务逻辑在 lib/user_level_lib.js，
// 回调内 require 调用（与 login_security.pb.js / stats_track.pb.js 一致）。

// 评论创建后更新统计并检查升级
onRecordAfterCreateRequest(function (e) {
  require(__hooks + '/lib/user_level_lib.js').onCommentCreated(e);
}, 'comments');

// 点赞后更新获赞统计
onRecordAfterUpdateRequest(function (e) {
  require(__hooks + '/lib/user_level_lib.js').onCommentUpdated(e);
}, 'comments');
})();
