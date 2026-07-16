import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

class FakeSchema {
  constructor(fields = []) {
    this.fields = new Map(fields.map((field) => [field.name, { ...field }]));
  }

  addField(field) {
    this.fields.set(field.name, { ...field });
  }

  getFieldByName(name) {
    const field = this.fields.get(name);
    if (!field) throw new Error(`missing field ${name}`);
    return field;
  }

  removeField(id) {
    for (const [name, field] of this.fields) {
      if (field.id === id) this.fields.delete(name);
    }
  }
}

class FakeCollection {
  constructor(input) {
    Object.assign(this, input);
    this.id ||= `${input.name}-id`;
    this.schema = new FakeSchema(input.schema || []);
    this.records ||= [];
  }
}

let nextRecordId = 1;
class FakeRecord {
  constructor(collection, values = {}) {
    this.collection = collection;
    this.id = values.id || `record-${nextRecordId++}`;
    this.values = { ...values, id: this.id };
  }

  get(name) { return this.values[name]; }
  getString(name) { return String(this.values[name] || ''); }
  set(name, value) { this.values[name] = value; }
}

class FakeDao {
  constructor(collections, pageCap = 2) {
    this.collections = new Map(collections.map((collection) => [collection.name, collection]));
    this.pageCap = pageCap;
  }

  findCollectionByNameOrId(name) {
    const collection = this.collections.get(name);
    if (!collection) throw new Error(`missing collection ${name}`);
    return collection;
  }

  saveCollection(collection) {
    this.collections.set(collection.name, collection);
  }

  deleteCollection(collection) {
    this.collections.delete(collection.name);
  }

  findRecordsByFilter(collectionName, _filter, _sort, limit, offset) {
    const records = this.findCollectionByNameOrId(collectionName).records;
    const size = Math.min(Number(limit) || this.pageCap, this.pageCap);
    return records.slice(Number(offset) || 0, (Number(offset) || 0) + size);
  }

  deleteRecord(record) {
    const records = record.collection.records;
    const index = records.indexOf(record);
    if (index >= 0) records.splice(index, 1);
  }

  saveRecord(record) {
    if (!record.collection.records.includes(record)) record.collection.records.push(record);
  }
}

function collection(name, fields = []) {
  return new FakeCollection({ name, type: 'base', schema: fields, records: [] });
}

function seed(target, values) {
  const record = new FakeRecord(target, values);
  target.records.push(record);
  return record;
}

async function loadUpCallback(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let up;
  const context = vm.createContext({
    migrate(upCallback) { up = upCallback; },
    Dao: class { constructor(db) { return db.dao; } },
    Collection: FakeCollection,
    SchemaField: class { constructor(input) { Object.assign(this, input); } },
    Record: FakeRecord,
  });
  new vm.Script(source, { filename: relativePath }).runInContext(context);
  assert.equal(typeof up, 'function');
  return up;
}

test('step-up migration drains every challenge page and backfills every historical Passkey owner', async () => {
  const users = collection('users');
  const challenges = collection('webauthn_challenges', [{ id: 'purpose-id', name: 'purpose' }]);
  const passkeys = collection('admin_passkeys');
  for (let index = 0; index < 5; index++) {
    seed(challenges, { id: `challenge-${index}` });
    seed(passkeys, { id: `passkey-${index}`, owner: `user-${index}`, created: `2026-07-16 00:00:0${index}.000Z` });
  }
  seed(passkeys, { id: 'passkey-duplicate', owner: 'user-4', created: '2026-07-16 00:01:00.000Z' });
  const dao = new FakeDao([users, challenges, passkeys], 2);
  const up = await loadUpCallback('../../pb_migrations/20260716100000_create_admin_step_up_security.pb.js');

  up({ dao });

  assert.equal(challenges.records.length, 0);
  const state = dao.findCollectionByNameOrId('admin_passkey_state');
  assert.deepEqual(new Set(state.records.map((record) => record.get('user'))), new Set(['user-0', 'user-1', 'user-2', 'user-3', 'user-4']));
});

test('recovery cutover migration drains every challenge and legacy-session page', async () => {
  const state = collection('admin_passkey_state');
  const challenges = collection('webauthn_challenges', [{ id: 'purpose-id', name: 'purpose' }]);
  const legacy = collection('admin_verified_sessions');
  for (let index = 0; index < 5; index++) {
    seed(challenges, { id: `challenge-${index}` });
    seed(legacy, { id: `legacy-${index}` });
  }
  const dao = new FakeDao([state, challenges, legacy], 2);
  const up = await loadUpCallback('../../pb_migrations/20260716100500_harden_admin_recovery_cutover.pb.js');

  up({ dao });

  assert.equal(challenges.records.length, 0);
  assert.equal(legacy.records.length, 0);
});
