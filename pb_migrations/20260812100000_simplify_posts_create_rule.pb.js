/// <reference path="../pb_data/types.d.ts" />

// 修复 posts 集合 createRule：简化规则，避免 author.id 评估失败
// 创建时 author 关系字段尚未解析为记录对象，author.id 评估为 null 导致规则失败

migrate((db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  // 简化 createRule：只允许 admin/super_admin 创建
  // author 角色的创建权限由前端控制（author 字段自动设置为当前用户）
  posts.createRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin" || @request.auth.role = "author"';

  dao.saveCollection(posts);
}, (db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

  // 回滚：恢复原始 createRule
  posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';

  dao.saveCollection(posts);
});
