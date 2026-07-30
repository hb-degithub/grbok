/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  function addField(collection, field) {
    collection.schema.addField(new SchemaField(field));
  }

  // esa_purge_settings：ESA API 凭证（单条，secret 加密存储，仅 hook 内访问）
  try {
    dao.findCollectionByNameOrId('esa_purge_settings');
  } catch (_) {
    const settings = new Collection({
      name: 'esa_purge_settings',
      type: 'base',
      system: false,
      schema: [],
    });

    addField(settings, { name: 'access_key_id', type: 'text', required: false, options: { min: null, max: 128, pattern: '' } });
    addField(settings, { name: 'access_key_secret_enc', type: 'text', required: false, options: { min: null, max: 2048, pattern: '' } });
    addField(settings, { name: 'site_id', type: 'number', required: false, options: { min: 1, max: null, noDecimal: true } });
    addField(settings, { name: 'enabled', type: 'bool', required: false, options: {} });
    addField(settings, { name: 'updated_by', type: 'text', required: false, options: { min: null, max: 64, pattern: '' } });

    settings.listRule = null;
    settings.viewRule = null;
    settings.createRule = null;
    settings.updateRule = null;
    settings.deleteRule = null;

    dao.saveCollection(settings);
  }

  // esa_purge_tasks：刷新任务记录（仅 hook 内访问）
  try {
    dao.findCollectionByNameOrId('esa_purge_tasks');
  } catch (_) {
    const tasks = new Collection({
      name: 'esa_purge_tasks',
      type: 'base',
      system: false,
      schema: [],
    });

    addField(tasks, { name: 'task_id', type: 'text', required: false, options: { min: null, max: 128, pattern: '' } });
    addField(tasks, { name: 'type', type: 'text', required: false, options: { min: null, max: 32, pattern: '' } });
    addField(tasks, { name: 'content', type: 'json', required: false, options: { maxSize: 2000000 } });
    addField(tasks, { name: 'status', type: 'text', required: false, options: { min: null, max: 32, pattern: '' } });
    addField(tasks, { name: 'message', type: 'text', required: false, options: { min: null, max: 512, pattern: '' } });
    addField(tasks, { name: 'created_by', type: 'text', required: false, options: { min: null, max: 64, pattern: '' } });

    tasks.listRule = null;
    tasks.viewRule = null;
    tasks.createRule = null;
    tasks.updateRule = null;
    tasks.deleteRule = null;

    tasks.indexes = [
      'CREATE INDEX IF NOT EXISTS idx_esa_purge_tasks_created ON esa_purge_tasks (created)',
    ];

    dao.saveCollection(tasks);
  }
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('esa_purge_tasks'));
  } catch (_) {}
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('esa_purge_settings'));
  } catch (_) {}
});
