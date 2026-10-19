/// <reference path="../pb_data/types.d.ts" />

// posts 增加 is_ai 字段：标记由 AI 一键成文路由创建的文章（后台列表显示 AI 徽标）
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  const posts = dao.findCollectionByNameOrId('posts');
  if (!posts) throw new Error('posts collection is required');

  let existing = null;
  try { existing = posts.schema.getFieldByName('is_ai'); } catch (_) {}
  if (!existing) {
    posts.schema.addField(new SchemaField({ name: 'is_ai', type: 'bool', required: false, options: {} }));
    dao.saveCollection(posts);
  }
}, (db) => {
  const dao = new Dao(db);
  try {
    const posts = dao.findCollectionByNameOrId('posts');
    if (posts) {
      const field = posts.schema.getFieldByName('is_ai');
      if (field) {
        posts.schema.removeField(field.id);
        dao.saveCollection(posts);
      }
    }
  } catch (_) {}
});
