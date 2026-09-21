(function () {
/// <reference path="../pb_data/types.d.ts" />

// AI 管理路由（薄壳）。业务逻辑全在 lib/ai_admin.js ——
// PB 0.22 JSVM 下 routerAdd 回调按源码字符串在请求级 runtime 重新 eval，
// 访问不到本 IIFE 的文件级闭包，因此 handler 内 require 调用。
//
// 鉴权：先 requireTrustedAdminIp（lib/ai_admin.js 内复制 mail_admin.js:17-22 的实现），
// 再 admin_step_up.requireAdminStepUp。settings/test 用 super_admin + 邮箱已验证；
// article/assist/comments.* 允许 author/admin 角色（step-up 本身已限制 role ∈ author/admin/super_admin）。
//
// 限流：ai_assist / ai_article 两把策略键在 lib/security_policy_store.js 的
// DEFAULTS/BOUNDS 与 20260921000300_add_ai_rate_policies.pb.js 迁移中双侧注册。

// GET /api/blog-admin/ai/settings — 脱敏回显 AI 配置（绝不含明文 api_key）
routerAdd('GET', '/api/blog-admin/ai/settings', function (c) {
  return require(__hooks + '/lib/ai_admin.js').settingsRead(c);
});

// PUT /api/blog-admin/ai/settings — 保存 AI 配置（api_key 留空 = 保留原值）
routerAdd('PUT', '/api/blog-admin/ai/settings', function (c) {
  return require(__hooks + '/lib/ai_admin.js').settingsSave(c);
}, $apis.bodyLimit(8192));

// POST /api/blog-admin/ai/test — 连通性探测（pong），失败以 200 + ok:false 回传
routerAdd('POST', '/api/blog-admin/ai/test', function (c) {
  return require(__hooks + '/lib/ai_admin.js').testConnection(c);
}, $apis.bodyLimit(8192));

// POST /api/blog-admin/ai/article — 一键成文（生成 + 落库草稿/发布）
routerAdd('POST', '/api/blog-admin/ai/article', function (c) {
  return require(__hooks + '/lib/ai_admin.js').generateArticle(c);
}, $apis.bodyLimit(65536));

// POST /api/blog-admin/ai/assist — 写作助手（meta / polish / continue）
routerAdd('POST', '/api/blog-admin/ai/assist', function (c) {
  return require(__hooks + '/lib/ai_admin.js').assist(c);
}, $apis.bodyLimit(65536));

// POST /api/blog-admin/ai/comments/moderate — 评论审核页手动触发单条 AI 审核
routerAdd('POST', '/api/blog-admin/ai/comments/moderate', function (c) {
  return require(__hooks + '/lib/ai_admin.js').moderateComment(c);
}, $apis.bodyLimit(8192));

// POST /api/blog-admin/ai/comments/reply — 评论审核页手动触发单条 AI 回复
routerAdd('POST', '/api/blog-admin/ai/comments/reply', function (c) {
  return require(__hooks + '/lib/ai_admin.js').replyComment(c);
}, $apis.bodyLimit(8192));

})();
