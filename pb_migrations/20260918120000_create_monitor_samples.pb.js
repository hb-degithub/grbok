/// <reference path="../pb_data/types.d.ts" />

// 监控采样表：monitor_probe cron 每分钟写入各目标(site_http/pb_self/admin_auth)的
// 可达性与延迟。全部规则 null(仅服务端 hooks 读写,不暴露 REST)。
migrate((db) => {
  const dao = new Dao(db);

  let existing = null;
  try { existing = dao.findCollectionByNameOrId('monitor_samples'); } catch (_) {}
  if (existing) return; // 幂等:已存在则跳过

  const collection = new Collection({
    name: 'monitor_samples',
    type: 'base',
    system: false,
    schema: [],
  });

  function addField(field) {
    collection.schema.addField(new SchemaField(field));
  }

  // 探针目标:site_http(整站 HTTP)/ pb_self(PB 自身查询)/ admin_auth(认证与邮件网关)
  addField({ name: 'target', type: 'text', required: true, options: { min: 1, max: 40, pattern: '^[a-z0-9_]+$' } });
  addField({ name: 'ok', type: 'bool', required: false });
  addField({ name: 'latency_ms', type: 'number', required: false, options: { min: 0, max: 600000 } });
  addField({ name: 'status_code', type: 'number', required: false, options: { min: 0, max: 999 } });
  // 失败原因摘要(仅后台可见,不入公开接口)
  addField({ name: 'error', type: 'text', required: false, options: { min: null, max: 200, pattern: '' } });

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  collection.indexes = [
    'CREATE INDEX idx_monitor_samples_target_created ON monitor_samples (target, created)',
    'CREATE INDEX idx_monitor_samples_created ON monitor_samples (created)',
  ];

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    const collection = dao.findCollectionByNameOrId('monitor_samples');
    dao.deleteCollection(collection);
  } catch (_) {}
});
