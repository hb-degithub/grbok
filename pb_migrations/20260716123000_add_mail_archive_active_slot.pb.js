/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  let activeField = null;
  try { activeField = batches.schema.getFieldByName('active_slot'); } catch (_) {}
  if (!activeField) {
    batches.schema.addField(new SchemaField({
      name: 'active_slot',
      type: 'text',
      required: false,
      options: { min: null, max: 20, pattern: '^active$' },
    }));
  }
  const indexes = (batches.indexes || []).filter((sql) => sql.indexOf('idx_mail_archive_batches_one_active') === -1);
  indexes.push('CREATE UNIQUE INDEX idx_mail_archive_batches_one_active ON mail_archive_batches (active_slot) WHERE active_slot = "active"');
  batches.indexes = indexes;
  dao.saveCollection(batches);
}, (db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  batches.indexes = (batches.indexes || []).filter((sql) => sql.indexOf('idx_mail_archive_batches_one_active') === -1);
  try { batches.schema.removeField(batches.schema.getFieldByName('active_slot').id); } catch (_) {}
  dao.saveCollection(batches);
});
