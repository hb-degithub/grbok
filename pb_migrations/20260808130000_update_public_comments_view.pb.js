/// <reference path="../pb_data/types.d.ts" />

// 更新 public_comments 视图，包含 author_level（通过 author_user 关联 users.level）

migrate((db) => {
  const dao = new Dao(db);

  const publicComments = dao.findCollectionByNameOrId('public_comments');
  if (!publicComments) throw new Error('public_comments collection is required');

  // 更新视图查询，通过 author_user 关联 users.level
  publicComments.options = {
    query: `SELECT 
      comments.id,
      comments.post_id,
      comments.author_name,
      comments.content,
      comments.parent_id,
      comments.status,
      comments.created,
      comments.updated,
      comments.likes,
      comments.edited,
      comments.edited_at,
      comments.deleted,
      users.level as author_level
    FROM comments
    LEFT JOIN users ON comments.author_user = users.id
    WHERE comments.status = "approved" AND comments.deleted = false`
  };

  dao.saveCollection(publicComments);
}, (db) => {
  // 回滚：恢复旧视图
  const dao = new Dao(db);
  const publicComments = dao.findCollectionByNameOrId('public_comments');
  if (publicComments) {
    publicComments.options = {
      query: 'SELECT id, post_id, author_name, content, parent_id, status, created, updated FROM comments WHERE status = "approved"'
    };
    dao.saveCollection(publicComments);
  }
});
