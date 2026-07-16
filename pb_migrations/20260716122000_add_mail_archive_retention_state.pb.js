/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  let retentionField = null;
  try { retentionField = batches.schema.getFieldByName('retention_confirmed_at'); } catch (_) {}
  if (!retentionField) {
    batches.schema.addField(new SchemaField({
      name: 'retention_confirmed_at',
      type: 'date',
      required: false,
      options: { min: '', max: '' },
    }));
  }
  const indexes = (batches.indexes || []).filter((sql) => sql.indexOf('idx_mail_archive_batches_retention_due') === -1);
  indexes.push('CREATE INDEX idx_mail_archive_batches_retention_due ON mail_archive_batches (status, retention_confirmed_at, max_created_at, batch_id)');
  batches.indexes = indexes;
  dao.saveCollection(batches);
}, (db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  batches.indexes = (batches.indexes || []).filter((sql) => sql.indexOf('idx_mail_archive_batches_retention_due') === -1);
  try { batches.schema.removeField(batches.schema.getFieldByName('retention_confirmed_at').id); } catch (_) {}
  dao.saveCollection(batches);
});
