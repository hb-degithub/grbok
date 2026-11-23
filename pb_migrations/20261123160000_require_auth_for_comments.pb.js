/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 2026-11-23 评论必须登录后提交（匿名评论关闭）。
//
// 背景：comments.createRule 自 20260627052000_tighten_comment_create_rule.pb.js 起是
//   post_id.status = "published"
// 即「匿名可提交」（安全审计 L3 遗留项：createRule 宽松，单点依赖 validate_comment.pb.js
// 的钩子兜底）。匿名提交会消耗评论限流配额、写入作者昵称/邮箱，并让冒名评论（邮箱属于
// 他人账号）只能靠钩子静默降级为 pending，属于不必要的公开写入面。
//
// 本迁移把 createRule 改为「已登录 + 目标文章已发布」：
//   @request.auth.id != "" && post_id.status = "published"
//
// 与现有钩子的关系（本迁移不修改任何 hook）：
// - 角色/邮箱验证门槛仍由 pb_hooks/validate_comment.pb.js 负责：已登录但邮箱未验证的
//   用户仍会收到「请先验证你的邮箱后再发表评论」（BadRequestError），行为不变；
// - 匿名请求在规则层被拒，HTTP 由 PocketBase 统一返回 400/403（无需额外 hook）；
// - 服务端 DAO 写入（AI 评论 worker 等）不受 API 规则限制，行为不变；
// - 管理后台审核/更新走 updateRule，不受本迁移影响。
//
// 前置条件：前端 CommentForm 已在登录态从 authStore 预填 author_name/author_email，
// 且 blog_auth 的 OTP 登录通过 $apis.recordAuthResponse 签发标准 PB token，
// 因此已登录用户提交仍能通过 @request.auth.id != "" 判定。
//
// 本迁移只做直接赋值，不使用原生数组方法（项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);

  let comments = null;
  try {
    comments = dao.findCollectionByNameOrId('comments');
  } catch (_) {
    comments = null;
  }
  if (!comments) {
    throw new Error('comments collection is required before requiring auth to comment');
  }

  comments.createRule = '@request.auth.id != "" && post_id.status = "published"';
  dao.saveCollection(comments);
  console.log('[comments] createRule now requires an authenticated user');
}, (db) => {
  // 回滚：恢复「匿名可提交」的旧规则（与 20260627052000 迁移的终态一致）。
  const dao = new Dao(db);

  let comments = null;
  try {
    comments = dao.findCollectionByNameOrId('comments');
  } catch (_) {
    comments = null;
  }
  if (!comments) {
    throw new Error('comments collection is required to roll back the auth-only comment rule');
  }

  comments.createRule = 'post_id.status = "published"';
  dao.saveCollection(comments);
  console.log('[comments] createRule rolled back to anonymous submission');
});
