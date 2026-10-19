/// <reference path="../pb_data/types.d.ts" />

// comments 增加 AI 管线字段：
//   is_ai        —— 该条评论由 AI 生成（前台显示 AI 徽标）
//   ai_moderated —— AI 审核 worker 已处理（防每分钟重复扫描重试烧钱）
//   ai_replied   —— AI 回复 worker 已处理（无论实际生成还是跳过）
//   ai_verdict   —— AI 审核结论：approve|spam|unsure|error（空=未审核）
//   ai_reason    —— AI 审核理由（≤500 字，后台审核页展示）
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  const comments = dao.findCollectionByNameOrId('comments');
  if (!comments) throw new Error('comments collection is required');

  function ensureField(field) {
    try {
      const existing = comments.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    comments.schema.addField(new SchemaField(field));
  }

  ensureField({ name: 'is_ai', type: 'bool', required: false, options: {} });
  ensureField({ name: 'ai_moderated', type: 'bool', required: false, options: {} });
  ensureField({ name: 'ai_replied', type: 'bool', required: false, options: {} });
  ensureField({ name: 'ai_verdict', type: 'text', required: false, options: { min: null, max: 20, pattern: '' } });
  ensureField({ name: 'ai_reason', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });

  // worker 两个扫描查询都按 status/ai_moderated 过滤
  const indexes = comments.indexes || [];
  let hasIndex = false;
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf('idx_comments_ai_scan') !== -1) { hasIndex = true; break; }
  }
  if (!hasIndex) {
    indexes.push('CREATE INDEX IF NOT EXISTS idx_comments_ai_scan ON comments (status, ai_moderated)');
    comments.indexes = indexes;
  }

  dao.saveCollection(comments);
}, (db) => {
  const dao = new Dao(db);
  try {
    const comments = dao.findCollectionByNameOrId('comments');
    if (comments) {
      const names = ['is_ai', 'ai_moderated', 'ai_replied', 'ai_verdict', 'ai_reason'];
      for (let i = 0; i < names.length; i++) {
        try {
          const field = comments.schema.getFieldByName(names[i]);
          if (field) comments.schema.removeField(field.id);
        } catch (_) {}
      }
      const indexes = comments.indexes || [];
      const kept = [];
      for (let i = 0; i < indexes.length; i++) {
        if (String(indexes[i]).indexOf('idx_comments_ai_scan') === -1) kept.push(indexes[i]);
      }
      comments.indexes = kept;
      dao.saveCollection(comments);
    }
  } catch (_) {}
});
