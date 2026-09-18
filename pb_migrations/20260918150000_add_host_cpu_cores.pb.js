/// <reference path="../pb_data/types.d.ts" />

// monitor_host_samples 增加 CPU 核数字段(用于前台展示服务器规格)
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('monitor_host_samples');

  // getFieldByName 缺失时返回 null(不抛异常),必须判空
  var existing = null;
  try { existing = collection.schema.getFieldByName('cpu_cores'); } catch (_) {}
  if (existing) return; // 幂等

  collection.schema.addField(new SchemaField({ name: 'cpu_cores', type: 'number', required: false, options: { min: 0, max: 1024 } }));
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    const collection = dao.findCollectionByNameOrId('monitor_host_samples');
    const field = collection.schema.getFieldByName('cpu_cores');
    collection.schema.removeField(field.id);
    dao.saveCollection(collection);
  } catch (_) {}
});
