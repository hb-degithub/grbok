/// <reference path="../pb_data/types.d.ts" />

// 评论点赞防重：服务端私有 comment_likes 集合。
// visitor_hash 是 MAIL_HASH_SECRET HMAC，不保存原始 IP/User-Agent；
// comment + visitor_hash 唯一索引同时保证幂等和并发安全。
// 注意：PocketBase 迁移脚本避免依赖原生数组高阶方法。

migrate((db) => {
  const dao = new Dao(db);
  const comments = dao.findCollectionByNameOrId('comments');
  if (!comments) throw new Error('comments collection is required');

  let likes;
  try {
    likes = dao.findCollectionByNameOrId('comment_likes');
  } catch (_) {
    likes = new Collection({
      name: 'comment_likes',
      type: 'base',
      system: false,
      schema: [],
    });
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  ensureField(likes, {
    name: 'comment',
    type: 'relation',
    required: true,
    options: {
      collectionId: comments.id,
      cascadeDelete: true,
      minSelect: null,
      maxSelect: 1,
      displayFields: ['author_name'],
    },
  });
  ensureField(likes, {
    name: 'visitor_hash',
    type: 'text',
    required: true,
    options: { min: 32, max: 256, pattern: '' },
  });

  // 只允许服务端 hooks 通过 DAO 访问，公共 REST API 完全关闭。
  likes.listRule = null;
  likes.viewRule = null;
  likes.createRule = null;
  likes.updateRule = null;
  likes.deleteRule = null;

  const uniqueIndex = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_likes_unique ON comment_likes (comment, visitor_hash)';
  const indexes = likes.indexes || [];
  let hasUniqueIndex = false;
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf('idx_comment_likes_unique') !== -1) {
      hasUniqueIndex = true;
      break;
    }
  }
  if (!hasUniqueIndex) indexes[indexes.length] = uniqueIndex;
  likes.indexes = indexes;

  dao.saveCollection(likes);
}, (db) => {
  const dao = new Dao(db);
  try {
    const likes = dao.findCollectionByNameOrId('comment_likes');
    dao.deleteCollection(likes);
  } catch (_) {}
});
