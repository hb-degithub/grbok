/// <reference path="../pb_data/types.d.ts" />

// 防护拦截统计快照:宿主机 cron 采集器汇总雷池检测/拦截计数后
// POST 到 /api/internal/monitor/protection 落库。规则全 null,不暴露 REST。
migrate((db) => {
  const dao = new Dao(db);

  let existing = null;
  try { existing = dao.findCollectionByNameOrId('protection_snapshots'); } catch (_) {}
  if (existing) return; // 幂等

  const collection = new Collection({
    name: 'protection_snapshots',
    type: 'base',
    system: false,
    schema: [],
  });

  function addField(field) {
    collection.schema.addField(new SchemaField(field));
  }

  addField({ name: 'source', type: 'text', required: true, options: { min: 1, max: 20, pattern: '^[a-z0-9_]+$' } });
  addField({ name: 'ok', type: 'bool', required: false });
  addField({ name: 'detected', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'blocked', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'challenged', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'window_hours', type: 'number', required: false, options: { min: 1, max: 720 } });
  // 采集窗口的截止时间(采集器本地时钟),用于过期判定
  addField({ name: 'sampled_at', type: 'text', required: false, options: { min: null, max: 40, pattern: '' } });
  addField({ name: 'error', type: 'text', required: false, options: { min: null, max: 200, pattern: '' } });

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  collection.indexes = ['CREATE INDEX idx_protection_snapshots_created ON protection_snapshots (created)'];

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    const collection = dao.findCollectionByNameOrId('protection_snapshots');
    dao.deleteCollection(collection);
  } catch (_) {}
});
