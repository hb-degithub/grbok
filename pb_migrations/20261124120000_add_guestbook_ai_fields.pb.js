/// <reference path="../pb_data/types.d.ts" />

// guestbook_messages 增加 AI 审核字段（供 POST /api/blog-admin/ai/guestbook/moderate 回写）：
//   ai_verdict   —— AI 审核结论：approve|spam|unsure|error（空 = 未审核）
//   ai_reason    —— AI 审核理由（≤500 字，后台留言审核页展示）
//   ai_moderated —— AI 审核已执行（与 comments 的同名字段语义一致）
//
// 字段只由服务端（DAO）写入；集合现有 API 规则保持不变：
//   listRule/viewRule = 'status = "show"'、createRule = ''、update/delete = super_admin。
// 匿名读取仍只放行 status = "show" 的行，因此 ai_reason 不会随公开列表外泄；
// 轮询重试的防重复语义由 ai_moderated 承担（与评论 AI 管线一致）。
//
// up 幂等：已存在同名字段时复用原 field id 再 addField（项目迁移通用写法）。
// down：只删除这三个字段，不动任何数据行。
// 注意：PocketBase 迁移脚本禁用原生数组方法（map/filter/forEach 等为项目已知陷阱）。

migrate((db) => {
  const dao = new Dao(db);

  let messages = null;
  try {
    messages = dao.findCollectionByNameOrId('guestbook_messages');
  } catch (_) {
    messages = null;
  }
  if (!messages) throw new Error('guestbook_messages collection is required');

  function ensureField(field) {
    try {
      const existing = messages.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    messages.schema.addField(new SchemaField(field));
  }

  ensureField({ name: 'ai_moderated', type: 'bool', required: false, options: {} });
  ensureField({ name: 'ai_verdict', type: 'text', required: false, options: { min: null, max: 20, pattern: '' } });
  ensureField({ name: 'ai_reason', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });

  dao.saveCollection(messages);
}, (db) => {
  const dao = new Dao(db);
  try {
    const messages = dao.findCollectionByNameOrId('guestbook_messages');
    if (messages) {
      const names = ['ai_moderated', 'ai_verdict', 'ai_reason'];
      for (let i = 0; i < names.length; i++) {
        try {
          const field = messages.schema.getFieldByName(names[i]);
          if (field) messages.schema.removeField(field.id);
        } catch (_) {}
      }
      dao.saveCollection(messages);
    }
  } catch (_) {}
});
