/// <reference path="../pb_data/types.d.ts" />

// 修复 settings.value 必填 JSON 校验与"可空设置项"的设计冲突(2026-09-19 生产事故):
// settings 表中 site_logo 等 key 从未入库,前端保存设置时对缺失 key 走 create,
// 空字符串值被 required JSON 字段判空拒绝(400 validation),导致"以下设置保存失败:site_logo"。
// 本迁移把 value 字段放宽为非必填——空字符串本身是合法的设置值(如"未配置 logo"),
// 仅放宽校验,不影响存量数据。该迁移幂等:已为非必填时直接跳过。

migrate((db) => {
  const dao = new Dao(db);
  let collection;
  try {
    collection = dao.findCollectionByNameOrId('settings');
  } catch (_) {
    return; // 集合不存在，跳过
  }
  const field = collection.schema.getFieldByName('value');
  if (!field || field.required !== true) return;
  field.required = false;
  dao.saveCollection(collection);
  console.log('[migration] settings.value 已放宽为非必填(允许空字符串设置项)');
}, (db) => {
  const dao = new Dao(db);
  let collection;
  try {
    collection = dao.findCollectionByNameOrId('settings');
  } catch (_) {
    return;
  }
  const field = collection.schema.getFieldByName('value');
  if (!field || field.required === true) return;
  field.required = true;
  dao.saveCollection(collection);
  console.log('[migration] settings.value 已恢复为必填');
});
