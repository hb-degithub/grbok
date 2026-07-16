/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  function addField(collection, definition) { collection.schema.addField(new SchemaField(definition)); }
  function makePrivate(collection) {
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;
  }

  const batches = new Collection({ name: 'mail_archive_batches', type: 'base', system: false, schema: [] });
  addField(batches, { name: 'batch_id', type: 'text', required: true, options: { min: 16, max: 100, pattern: '^[A-Za-z0-9_-]+$' } });
  addField(batches, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['prepared', 'sealed', 'uploaded', 'committed'] } });
  addField(batches, { name: 'cursor', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
  addField(batches, { name: 'row_count', type: 'number', required: true, options: { min: 1, max: 5000, noDecimal: true } });
  addField(batches, { name: 'min_created_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(batches, { name: 'max_created_at', type: 'date', required: true, options: { min: '', max: '' } });
  ['plaintext_sha256', 'gzip_sha256', 'cipher_sha256'].forEach((name) => addField(batches, { name: name, type: 'text', required: false, options: { min: null, max: 64, pattern: '^[a-f0-9]{64}$' } }));
  addField(batches, { name: 'cipher_size', type: 'number', required: false, options: { min: 1, max: null, noDecimal: true } });
  addField(batches, { name: 'age_recipient_fingerprint', type: 'text', required: false, options: { min: null, max: 200, pattern: '^[A-Za-z0-9:_-]*$' } });
  addField(batches, { name: 'object_key', type: 'text', required: false, options: { min: null, max: 300, pattern: '^[A-Za-z0-9._/-]*$' } });
  addField(batches, { name: 'manifest_sha256', type: 'text', required: false, options: { min: null, max: 64, pattern: '^[a-f0-9]{64}$' } });
  ['prepared_at', 'sealed_at', 'uploaded_at', 'committed_at'].forEach((name) => addField(batches, { name: name, type: 'date', required: false, options: { min: '', max: '' } }));
  addField(batches, { name: 'last_error_class', type: 'text', required: false, options: { min: null, max: 80, pattern: '^[A-Z0-9_]*$' } });
  makePrivate(batches);
  batches.indexes = [
    'CREATE UNIQUE INDEX idx_mail_archive_batches_batch_id ON mail_archive_batches (batch_id)',
    'CREATE INDEX idx_mail_archive_batches_status_created ON mail_archive_batches (status, created)',
    'CREATE INDEX idx_mail_archive_batches_max_created ON mail_archive_batches (max_created_at)',
  ];
  dao.saveCollection(batches);

  const nonces = new Collection({ name: 'mail_archive_request_nonces', type: 'base', system: false, schema: [] });
  addField(nonces, { name: 'nonce', type: 'text', required: true, options: { min: 16, max: 200, pattern: '^[A-Za-z0-9_-]+$' } });
  addField(nonces, { name: 'request_timestamp', type: 'date', required: true, options: { min: '', max: '' } });
  addField(nonces, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  makePrivate(nonces);
  nonces.indexes = [
    'CREATE UNIQUE INDEX idx_mail_archive_nonce_unique ON mail_archive_request_nonces (nonce)',
    'CREATE INDEX idx_mail_archive_nonce_expiry ON mail_archive_request_nonces (expires_at)',
  ];
  dao.saveCollection(nonces);

  const logs = dao.findCollectionByNameOrId('mail_delivery_logs');
  let archiveField = null;
  try { archiveField = logs.schema.getFieldByName('archive_batch_id'); } catch (_) {}
  if (!archiveField) addField(logs, { name: 'archive_batch_id', type: 'text', required: false, options: { min: null, max: 100, pattern: '^[A-Za-z0-9_-]*$' } });
  const indexes = (logs.indexes || []).filter((sql) => sql.indexOf('idx_mail_delivery_logs_archive_batch') === -1 && sql.indexOf('idx_mail_delivery_logs_archive_created') === -1);
  indexes.push('CREATE INDEX idx_mail_delivery_logs_archive_batch ON mail_delivery_logs (archive_batch_id)');
  indexes.push('CREATE INDEX idx_mail_delivery_logs_archive_created ON mail_delivery_logs (created, archive_batch_id)');
  logs.indexes = indexes;
  dao.saveCollection(logs);
}, (db) => {
  const dao = new Dao(db);
  try {
    const logs = dao.findCollectionByNameOrId('mail_delivery_logs');
    logs.indexes = (logs.indexes || []).filter((sql) => sql.indexOf('idx_mail_delivery_logs_archive_') === -1);
    try { logs.schema.removeField(logs.schema.getFieldByName('archive_batch_id').id); } catch (_) {}
    dao.saveCollection(logs);
  } catch (_) {}
  try { dao.deleteCollection(dao.findCollectionByNameOrId('mail_archive_request_nonces')); } catch (_) {}
  try { dao.deleteCollection(dao.findCollectionByNameOrId('mail_archive_batches')); } catch (_) {}
});
