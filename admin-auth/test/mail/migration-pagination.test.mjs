import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

it('paginates the delivery-log migration to EOF and emits only archive-compatible enums', () => {
  const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../pb_migrations/20260716111000_minimize_mail_delivery_logs.pb.js');
  const source = fs.readFileSync(migrationPath, 'utf8');
  let up;
  class Field { constructor(value) { Object.assign(this, value); this.id ||= this.name; } }
  const fields = new Map([
    'request_id','category','source_collection','source_record_id','recipient_masked','recipient_hash','request_ip_hash','result','duration_ms','attempt','error_class','rate_limited','decoy','created',
  ].map((name) => [name, new Field({ name, options: { min: 1, values: ['accepted','sent','failed','suppressed','rate_limited','decoy'] } })]));
  const schema = {
    getFieldByName(name) { return fields.get(name) || null; },
    addField(field) { fields.set(field.name, field); },
    removeField(id) { for (const [name, field] of fields) if (field.id === id) fields.delete(name); },
  };
  const collection = { schema, indexes: [] };
  const categories = ['operations_alert', 'registration_signup', 'unknown_comment', 'reader_otp', 'admin_test', 'unknown_account', 'comment_notification'];
  const rows = Array.from({ length: 1201 }, (_, index) => {
    const category = categories[index % categories.length];
    const values = {
      source_collection: category === 'unknown_comment' || category === 'comment_notification' ? 'comments' : 'users', category,
      result: index % 2 ? 'sent' : 'decoy', source_record_id: `record-${index}`, recipient_masked: 'secret', recipient_hash: 'hash', request_ip_hash: 'ip-hash',
      attempt: [0, 25, 'bad', 4][index % 4], duration_ms: [-1, 120001, 'bad', 12][index % 4],
    };
    return {
      values,
      get(name) { return values[name]; },
      getString(name) { return String(values[name] || ''); },
      set(name, value) { values[name] = value; },
    };
  });
  const calls = [];
  const dao = {
    findCollectionByNameOrId() { return collection; },
    saveCollection() {},
    findRecordsByFilter(_name, _filter, _sort, limit, offset) { calls.push({ limit, offset }); return rows.slice(offset, offset + limit); },
    saveRecord() {},
  };
  class Dao { constructor() { return dao; } }
  let sequence = 0;
  vm.runInNewContext(source, {
    migrate(upCallback) { up = upCallback; }, Dao, SchemaField: Field,
    $security: { randomStringWithAlphabet(length) { sequence += 1; return String(sequence).padStart(length, '0'); } },
  }, { filename: migrationPath });
  up({});
  assert.ok(calls.length >= 3, `expected multiple pages, got ${calls.length}`);
  assert.ok(calls.every((call) => call.limit <= 500), 'migration requested an unbounded page');
  assert.equal(new Set(rows.map((row) => row.values.event_id)).size, rows.length);
  const allowedCategories = new Set(['account_verification','account_password_reset','account_email_change','reader_otp','comment_new','comment_approved','comment_reply','admin_test','ops_alert','account_retention_notice']);
  const allowedSources = new Set(['account','reader','comment','admin','operations','retention','registration']);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    assert.equal(allowedCategories.has(row.values.category), true);
    assert.equal(allowedSources.has(row.values.source_kind), true);
    assert.equal(Number.isInteger(row.values.attempt) && row.values.attempt >= 1 && row.values.attempt <= 20, true);
    assert.equal(Number.isInteger(row.values.duration_ms) && row.values.duration_ms >= 0 && row.values.duration_ms <= 120000, true);
    assert.equal(row.values.error_class, 'INTERNAL_ERROR');
    for (const name of ['source_record_id','recipient_masked','recipient_hash','request_ip_hash']) assert.equal(row.values[name], '');
  }
  assert.equal(rows[0].values.category, 'ops_alert');
  assert.equal(rows[1].values.category, 'account_verification');
  assert.equal(rows[2].values.category, 'comment_new');
  assert.equal(rows[5].values.category, 'account_verification');
  assert.equal(rows[0].values.attempt, 1);
  assert.equal(rows[1].values.attempt, 20);
  assert.equal(rows[0].values.duration_ms, 0);
  assert.equal(rows[1].values.duration_ms, 120000);
  assert.equal(fields.get('event_id').required, true);
  assert.equal(fields.get('source_kind').required, true);
  assert.deepEqual(Array.from(fields.get('source_kind').options.values), [...allowedSources]);
  assert.ok(collection.indexes.some((value) => value.includes('UNIQUE INDEX idx_mail_delivery_logs_event_id')));
});
