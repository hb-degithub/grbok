migrate((db) => {
  const dao = new Dao(db);

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function save(collection) {
    dao.saveCollection(collection);
    return dao.findCollectionByNameOrId(collection.name);
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  let collection = find('audit_logs');
  if (!collection) {
    collection = new Collection({ name: 'audit_logs', type: 'base', system: false, schema: [] });
  }

  ensureField(collection, { name: 'actor', type: 'text', required: true, options: { min: null, max: 255, pattern: '' } });
  ensureField(collection, { name: 'action', type: 'text', required: true, options: { min: null, max: 100, pattern: '' } });
  ensureField(collection, { name: 'target_collection', type: 'text', required: false, options: { min: null, max: 100, pattern: '' } });
  ensureField(collection, { name: 'target_id', type: 'text', required: false, options: { min: null, max: 100, pattern: '' } });
  ensureField(collection, { name: 'summary', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  ensureField(collection, { name: 'ip', type: 'text', required: false, options: { min: null, max: 45, pattern: '' } });
  ensureField(collection, { name: 'user_agent', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  collection.listRule = '@request.auth.role = "super_admin"';
  collection.viewRule = '@request.auth.role = "super_admin"';
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  collection.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created DESC)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
  ];
  save(collection);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('audit_logs')); } catch (_) {}
});
