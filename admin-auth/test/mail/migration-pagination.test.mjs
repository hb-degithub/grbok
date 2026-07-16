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
  const rows = Array.from({ length: 1201 }, (_, index) => {
    const values = {
      source_collection: index % 3 === 0 ? 'comments' : 'users', category: index % 3 === 0 ? 'comment_notification' : index % 3 === 1 ? 'account_verification' : 'reader_otp',
      result: index % 2 ? 'sent' : 'decoy', source_record_id: `record-${index}`, recipient_masked: 'secret', recipient_hash: 'hash', request_ip_hash: 'ip-hash',
    };
    return { values, getString(name) { return String(values[name] || ''); }, set(name, value) { values[name] = value; } };
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
  const allowedSources = new Set(['account','reader','comment','admin','operations','retention','registration']);
  for (const row of rows) {
    assert.equal(allowedSources.has(row.values.source_kind), true);
    assert.equal(row.values.error_class, 'INTERNAL_ERROR');
    for (const name of ['source_record_id','recipient_masked','recipient_hash','request_ip_hash']) assert.equal(row.values[name], '');
  }
  assert.equal(fields.get('event_id').required, true);
  assert.equal(fields.get('source_kind').required, true);
  assert.deepEqual(Array.from(fields.get('source_kind').options.values), [...allowedSources]);
  assert.ok(collection.indexes.some((value) => value.includes('UNIQUE INDEX idx_mail_delivery_logs_event_id')));
});
