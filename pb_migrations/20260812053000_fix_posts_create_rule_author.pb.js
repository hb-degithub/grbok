/// <reference path="../pb_data/types.d.ts" />

// 修复 posts 集合 createRule 中 author.id 评估失败的问题
// 创建时 author 关系字段尚未解析为记录对象，author.id 评估为 null 导致规则失败
// 改为使用 @request.data.author（原始请求数据中的 author ID）

migrate((db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

  // 修复 createRule：使用 @request.data.author 替代 author.id
  // 创建时 author 关系字段尚未解析，author.id 评估失败导致 400
  posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && @request.data.author = @request.auth.id)';

  dao.saveCollection(posts);
}, (db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

  // 回滚：恢复原始 createRule
  posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';

  dao.saveCollection(posts);
});
