/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const collection = new Collection({
    name: 'mail_outbox', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    schema: [
      new SchemaField({ name: 'dedupe_key', type: 'text', required: true, options: { min: 1, max: 180, pattern: '' } }),
      new SchemaField({ name: 'event_id', type: 'text', required: true, options: { min: 22, max: 64, pattern: '^[A-Za-z0-9_-]+$' } }),
      new SchemaField({ name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['pending', 'processing', 'retry', 'sent', 'failed', 'cancelled'] } }),
      new SchemaField({ name: 'category', type: 'select', required: true, options: { maxSelect: 1, values: ['comment_notification', 'account_retention_notice'] } }),
      new SchemaField({ name: 'template_key', type: 'select', required: true, options: { maxSelect: 1, values: ['comment_new', 'account_retention_notice'] } }),
      new SchemaField({ name: 'recipient', type: 'email', required: false, options: { exceptDomains: [], onlyDomains: [] } }),
      new SchemaField({ name: 'variables_json', type: 'json', required: false, options: { maxSize: 16384 } }),
      new SchemaField({ name: 'attempt', type: 'number', required: true, options: { min: 0, max: 5, noDecimal: true } }),
      new SchemaField({ name: 'next_attempt_at', type: 'date', required: false, options: { min: '', max: '' } }),
      new SchemaField({ name: 'lease_until', type: 'date', required: false, options: { min: '', max: '' } }),
      new SchemaField({ name: 'last_error_class', type: 'text', required: false, options: { min: 0, max: 64, pattern: '' } }),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_mail_outbox_dedupe ON mail_outbox (dedupe_key)',
      'CREATE INDEX idx_mail_outbox_due ON mail_outbox (status, next_attempt_at, lease_until)',
      'CREATE INDEX idx_mail_outbox_created ON mail_outbox (created)',
    ],
  });
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('mail_outbox')); } catch (_) {}
});
