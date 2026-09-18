/// <reference path="../pb_data/types.d.ts" />

// 宿主机性能采样表:由宿主机 cron 脚本读 /proc 后 POST 到 /api/internal/monitor/host
// (仅回环 + 内部密钥可写)。规则全 null,不暴露 REST。
migrate((db) => {
  const dao = new Dao(db);

  let existing = null;
  try { existing = dao.findCollectionByNameOrId('monitor_host_samples'); } catch (_) {}
  if (existing) return; // 幂等

  const collection = new Collection({
    name: 'monitor_host_samples',
    type: 'base',
    system: false,
    schema: [],
  });

  function addField(field) {
    collection.schema.addField(new SchemaField(field));
  }

  addField({ name: 'cpu_pct', type: 'number', required: false, options: { min: 0, max: 100 } });
  addField({ name: 'mem_pct', type: 'number', required: false, options: { min: 0, max: 100 } });
  addField({ name: 'mem_used_mb', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'mem_total_mb', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'net_rx_kbps', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'net_tx_kbps', type: 'number', required: false, options: { min: 0, max: null } });
  addField({ name: 'disk_pct', type: 'number', required: false, options: { min: 0, max: 100 } });
  addField({ name: 'load1', type: 'number', required: false, options: { min: 0, max: null } });

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  collection.indexes = ['CREATE INDEX idx_monitor_host_samples_created ON monitor_host_samples (created)'];

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    const collection = dao.findCollectionByNameOrId('monitor_host_samples');
    dao.deleteCollection(collection);
  } catch (_) {}
});
