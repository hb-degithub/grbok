// PocketBase migration: create audit_logs collection
// Run on server: this file goes into pb_migrations/
migrate((db) => {
  const collection = new Collection({
    name: 'audit_logs',
    type: 'base',
    system: false,
    listRule: '@request.auth.role = "super_admin"',
    viewRule: '@request.auth.role = "super_admin"',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'actor', type: 'text', required: true, max: 255 },
      { name: 'action', type: 'text', required: true, max: 100 },
      { name: 'target_collection', type: 'text', max: 100 },
      { name: 'target_id', type: 'text', max: 100 },
      { name: 'summary', type: 'text', max: 500 },
      { name: 'ip', type: 'text', max: 45 },
      { name: 'user_agent', type: 'text', max: 500 },
    ],
    indexes: [
      'CREATE INDEX idx_audit_logs_created ON audit_logs(created DESC)',
      'CREATE INDEX idx_audit_logs_actor ON audit_logs(actor)',
      'CREATE INDEX idx_audit_logs_action ON audit_logs(action)',
    ],
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('audit_logs');
  if (collection) dao.deleteCollection(collection);
});
