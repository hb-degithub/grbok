/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const tombstones = new Collection({
    name: 'mail_archive_retention_tombstones',
    type: 'base',
    system: false,
    schema: [],
  });
  tombstones.schema.addField(new SchemaField({ name: 'batch_id', type: 'text', required: true, options: { min: 16, max: 100, pattern: '^[A-Za-z0-9_-]+$' } }));
  tombstones.schema.addField(new SchemaField({ name: 'confirmed_at', type: 'date', required: true, options: { min: '', max: '' } }));
  tombstones.schema.addField(new SchemaField({ name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } }));
  tombstones.listRule = null;
  tombstones.viewRule = null;
  tombstones.createRule = null;
  tombstones.updateRule = null;
  tombstones.deleteRule = null;
  tombstones.indexes = [
    'CREATE UNIQUE INDEX idx_mail_archive_retention_tombstones_batch ON mail_archive_retention_tombstones (batch_id)',
    'CREATE INDEX idx_mail_archive_retention_tombstones_expiry ON mail_archive_retention_tombstones (expires_at)',
  ];
  dao.saveCollection(tombstones);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('mail_archive_retention_tombstones')); } catch (_) {}
});
