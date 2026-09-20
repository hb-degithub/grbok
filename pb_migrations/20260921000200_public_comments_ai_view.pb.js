/// <reference path="../pb_data/types.d.ts" />

// 更新 public_comments 视图：增加 is_ai 列（前台评论区显示 AI 徽标）
// 其余列与 20260808130000_update_public_comments_view.pb.js 保持一致

migrate((db) => {
  const dao = new Dao(db);

  const publicComments = dao.findCollectionByNameOrId('public_comments');
  if (!publicComments) throw new Error('public_comments collection is required');

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
      comments.is_ai,
      users.level as author_level
    FROM comments
    LEFT JOIN users ON comments.author_user = users.id
    WHERE comments.status = "approved" AND comments.deleted = false`
  };

  dao.saveCollection(publicComments);
}, (db) => {
  // 回滚：恢复不含 is_ai 的上一版视图
  const dao = new Dao(db);
  const publicComments = dao.findCollectionByNameOrId('public_comments');
  if (publicComments) {
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
  }
});
