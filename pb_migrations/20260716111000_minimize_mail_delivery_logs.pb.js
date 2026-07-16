/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_delivery_logs');

  function add(field) {
    if (!collection.schema.getFieldByName(field.name)) {
      collection.schema.addField(new SchemaField(field));
    }
  }

  add({ name: 'event_id', type: 'text', required: false, options: { min: 0, max: 100, pattern: '' } });
  add({
    name: 'source_kind', type: 'select', required: false,
    options: { maxSelect: 1, values: ['account_mail', 'otp', 'comment', 'retention', 'admin_test', 'operations', 'legacy'] },
  });
  add({ name: 'archive_batch_id', type: 'text', required: false, options: { min: 0, max: 100, pattern: '' } });
  for (const name of ['source_record_id', 'recipient_masked', 'recipient_hash', 'request_ip_hash']) {
    const legacy = collection.schema.getFieldByName(name);
    if (legacy) {
      legacy.required = false;
      legacy.options.min = 0;
    }
  }
  dao.saveCollection(collection);

  const rows = dao.findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 100000, 0);
  for (const row of rows) {
    const source = row.getString('source_collection');
    const category = row.getString('category');
    let sourceKind = 'legacy';
    if (category === 'reader_otp') sourceKind = 'otp';
    else if (category.indexOf('account_') === 0) sourceKind = 'account_mail';
    else if (source === 'comments') sourceKind = 'comment';
    row.set('event_id', $security.randomStringWithAlphabet(22, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'));
    row.set('source_kind', sourceKind);
    row.set('result', row.getString('result') === 'sent' ? 'sent' : 'failed');
    row.set('error_class', 'legacy_minimized');
    row.set('source_record_id', '');
    row.set('recipient_masked', '');
    row.set('recipient_hash', '');
    row.set('request_ip_hash', '');
    dao.saveRecord(row);
  }

  for (const name of [
    'request_id', 'source_collection', 'source_record_id', 'recipient_masked',
    'recipient_hash', 'request_ip_hash', 'rate_limited', 'decoy',
  ]) {
    const field = collection.schema.getFieldByName(name);
    if (field) collection.schema.removeField(field.id);
  }
  collection.schema.getFieldByName('event_id').required = true;
  collection.schema.getFieldByName('event_id').options.min = 22;
  collection.schema.getFieldByName('source_kind').required = true;
  const resultField = collection.schema.getFieldByName('result');
  resultField.options.values = ['sent', 'failed'];
  collection.indexes = [
    'CREATE UNIQUE INDEX idx_mail_delivery_logs_event_id ON mail_delivery_logs (event_id)',
    'CREATE INDEX idx_mail_delivery_logs_created_category ON mail_delivery_logs (created, category)',
    'CREATE INDEX idx_mail_delivery_logs_archive_created ON mail_delivery_logs (archive_batch_id, created)',
  ];
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_delivery_logs');
  function add(field) {
    if (!collection.schema.getFieldByName(field.name)) collection.schema.addField(new SchemaField(field));
  }
  add({ name: 'request_id', type: 'text', required: false, options: { min: 0, max: 100, pattern: '' } });
  add({ name: 'source_collection', type: 'text', required: false, options: { min: 0, max: 100, pattern: '' } });
  add({ name: 'source_record_id', type: 'text', required: false, options: { min: 0, max: 100, pattern: '' } });
  add({ name: 'recipient_masked', type: 'text', required: false, options: { min: 0, max: 320, pattern: '' } });
  add({ name: 'recipient_hash', type: 'text', required: false, options: { min: 0, max: 255, pattern: '' } });
  add({ name: 'request_ip_hash', type: 'text', required: false, options: { min: 0, max: 255, pattern: '' } });
  dao.saveCollection(collection);
  const rows = dao.findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 100000, 0);
  for (const row of rows) {
    row.set('request_id', row.getString('event_id') || $security.randomStringWithAlphabet(22, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'));
    row.set('source_collection', row.getString('source_kind') || 'legacy');
    row.set('source_record_id', '');
    row.set('recipient_masked', '');
    row.set('recipient_hash', '');
    row.set('request_ip_hash', '');
    dao.saveRecord(row);
  }
  for (const name of ['event_id', 'source_kind', 'archive_batch_id']) {
    const field = collection.schema.getFieldByName(name);
    if (field) collection.schema.removeField(field.id);
  }
  const resultField = collection.schema.getFieldByName('result');
  resultField.options.values = ['accepted', 'sent', 'failed', 'suppressed', 'rate_limited', 'decoy'];
  collection.indexes = [
    'CREATE UNIQUE INDEX idx_mail_delivery_logs_request_id ON mail_delivery_logs (request_id)',
    'CREATE INDEX idx_mail_delivery_logs_created_category ON mail_delivery_logs (created, category)',
    'CREATE INDEX idx_mail_delivery_logs_recipient_hash ON mail_delivery_logs (recipient_hash, created)',
  ];
  dao.saveCollection(collection);
});
