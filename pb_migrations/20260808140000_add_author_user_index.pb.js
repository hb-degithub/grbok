/// <reference path="../pb_data/types.d.ts" />

// 添加 comments.author_user 索引（优化视图查询性能）

migrate((db) => {
  const dao = new Dao(db);

  const comments = dao.findCollectionByNameOrId('comments');
  if (!comments) throw new Error('comments collection is required');

  // 添加 author_user 索引
  const indexes = comments.indexes || [];
  const hasIndex = indexes.some((sql) => sql.indexOf('idx_comments_author_user') !== -1);
  if (!hasIndex) {
    indexes.push('CREATE INDEX IF NOT EXISTS idx_comments_author_user ON comments (author_user)');
    comments.indexes = indexes;
    dao.saveCollection(comments);
  }
}, (db) => {
  // 回滚：删除索引
  const dao = new Dao(db);
  const comments = dao.findCollectionByNameOrId('comments');
  if (comments) {
    const indexes = comments.indexes || [];
    comments.indexes = indexes.filter((sql) => sql.indexOf('idx_comments_author_user') === -1);
    dao.saveCollection(comments);
  }
});
