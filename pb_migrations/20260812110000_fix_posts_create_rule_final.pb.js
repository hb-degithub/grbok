/// <reference path="../pb_data/types.d.ts" />

// 修复 posts 集合 createRule：author.id 在创建时评估失败
// 改为使用 @request.data.author（原始请求数据中的 author ID）

migrate((db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  // 创建时 author 关系字段尚未解析，author.id 评估失败导致 400
  // 使用 @request.data.author 替代
  posts.createRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin" || (@request.auth.role = "author" && @request.data.author = @request.auth.id)';

  dao.saveCollection(posts);
}, (db) => {
  const dao = new Dao(db);
  const posts = dao.findCollectionByNameOrId("posts");

  // 回滚
  posts.createRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin" || (@request.auth.role = "author" && author.id = @request.auth.id)';

  dao.saveCollection(posts);
});
