/// <reference path="../pb_data/types.d.ts" />

// #30（生产已确认）：评论编辑/删除的邮箱验证码依赖 verificationCodes 集合，但
// pb_migrations/ 里从来没有创建过它 ⇒ 生产库不存在该集合。
// pb_hooks/lib/comment_verification.js 的惰性回退用
// `String(err).indexOf('collection')` 判断"集合缺失"，而 PocketBase 0.22 在
// findCollectionByNameOrId 失败时抛出的是通用 404 文案，该判断不成立 ⇒
// POST /api/comments/verification/send 恒返回 404，评论编辑/删除全部不可用。
//
// 本迁移按 comment_verification.js:createVerificationCollection() 的定义建集合：
//   email(text 1-320 必填) / code(text 6-6 必填, pattern ^[0-9]{6}$) /
//   expires_at(date 必填) / attempts(number 0-10 可空)
// 五条 API 规则全部 null（只有服务端可访问），并为 email 建普通索引
// （sendVerificationCode 按 email 查旧码、verifyCode 按 email 取最新码）。
// 幂等：集合已存在时只补齐字段/规则/索引，不报错、不重建。
// down：删除该集合（集合内只有 10 分钟有效的一次性验证码，无业务数据）。

migrate((db) => {
  const dao = new Dao(db);
  const NAME = 'verificationCodes';

  let collection = null;
  try {
    collection = dao.findCollectionByNameOrId(NAME);
  } catch (_) {
    collection = null;
  }
  if (!collection) {
    collection = new Collection({
      name: NAME,
      type: 'base',
      system: false,
      schema: [],
    });
  }

  function ensureField(field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  ensureField({ name: 'email', type: 'text', required: true, options: { min: 1, max: 320, pattern: '' } });
  ensureField({ name: 'code', type: 'text', required: true, options: { min: 6, max: 6, pattern: '^[0-9]{6}$' } });
  ensureField({ name: 'expires_at', type: 'date', required: true });
  ensureField({ name: 'attempts', type: 'number', required: false, options: { min: 0, max: 10 } });

  // 仅服务端：全部规则为 null，公共 REST 无法 list/view/create/update/delete。
  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;

  const indexes = collection.indexes || [];
  let hasEmailIndex = false;
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf('idx_verificationCodes_email') !== -1) {
      hasEmailIndex = true;
      break;
    }
  }
  if (!hasEmailIndex) {
    indexes[indexes.length] = 'CREATE INDEX IF NOT EXISTS idx_verificationCodes_email ON verificationCodes (email)';
    collection.indexes = indexes;
  }

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('verificationCodes'));
  } catch (_) {
    // 集合不存在即视为已回滚（幂等）。
  }
});
