/// <reference path="../pb_data/types.d.ts" />

// AI 功能配置集合（单条记录）：OpenAI 兼容端点、功能开关、违禁词表、回复人设。
// 5 条规则全 null —— 仅 pb_hooks 内部可读写；管理接口走 /api/blog-admin/ai/settings
// （可信管理 IP + step-up + super_admin）。api_key 以 PB_ENCRYPTION_KEY 派生密钥流
// 加密存于 api_key_enc，永不落明文。
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  let col = null;
  try { col = dao.findCollectionByNameOrId('ai_settings'); } catch (_) {}
  if (!col) {
    col = new Collection({ name: 'ai_settings', type: 'base', system: false, schema: [] });
  }

  function ensureField(field) {
    try {
      const existing = col.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    col.schema.addField(new SchemaField(field));
  }

  // 总开关：关闭时所有 AI 功能（含评论 worker）停用
  ensureField({ name: 'enabled', type: 'bool', required: false, options: {} });
  // OpenAI 兼容端点，如 https://api.deepseek.com/v1 或自建 new-api 地址
  ensureField({ name: 'base_url', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  ensureField({ name: 'api_key_enc', type: 'text', required: false, options: { min: null, max: 4000, pattern: '' } });
  ensureField({ name: 'model', type: 'text', required: false, options: { min: null, max: 120, pattern: '' } });
  // 单次请求超时（秒）。$http.send 为同步阻塞，上限 110 避免长时间占用 JSVM runtime
  ensureField({ name: 'timeout_seconds', type: 'number', required: false, options: { min: 10, max: 110, noDecimal: true } });
  // AI 一键成文落库时的初始状态
  ensureField({ name: 'article_publish_mode', type: 'select', required: false, options: { maxSelect: 1, values: ['draft', 'published'] } });
  // 评论 AI 管线档位：off 不参与 / manual 只打标记和建议 / assist 审核自动+回复草稿 / full_auto 审核与回复全自动
  ensureField({ name: 'comment_mode', type: 'select', required: false, options: { maxSelect: 1, values: ['off', 'manual', 'assist', 'full_auto'] } });
  // 违禁词本地拦截（独立开关，不依赖 AI 端点可用）
  ensureField({ name: 'banned_words_enabled', type: 'bool', required: false, options: {} });
  ensureField({ name: 'banned_words', type: 'json', required: false, options: { maxSize: 100000 } });
  // AI 回复的对外昵称与人设提示词
  ensureField({ name: 'reply_name', type: 'text', required: false, options: { min: null, max: 50, pattern: '' } });
  ensureField({ name: 'reply_persona', type: 'text', required: false, options: { min: null, max: 2000, pattern: '' } });
  ensureField({ name: 'updated_by', type: 'text', required: false, options: { min: null, max: 64, pattern: '' } });

  // 只允许经 hook 内部读写
  col.listRule = null;
  col.viewRule = null;
  col.createRule = null;
  col.updateRule = null;
  col.deleteRule = null;
  dao.saveCollection(col);
}, (db) => {
  const dao = new Dao(db);
  try {
    const col = dao.findCollectionByNameOrId('ai_settings');
    if (col) dao.deleteCollection(col);
  } catch (_) {}
});
