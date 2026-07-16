'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var repoRoot = path.resolve(__dirname, '..', '..');
var migrationPath = path.join(repoRoot, 'pb_migrations', '20260716120000_create_account_retention_state.pb.js');
var migrationSource = fs.readFileSync(migrationPath, 'utf8');
var migrateUp = null;

function FakeSchema() { this.fields = []; }
FakeSchema.prototype.addField = function (field) { this.fields.push(field); };

function Collection(definition) {
  Object.assign(this, definition);
  this.id = definition.name;
  this.schema = new FakeSchema();
  this.indexes = [];
}

function SchemaField(definition) { Object.assign(this, definition); }
function Record(collection) { this.collection = collection; this.values = {}; }
Record.prototype.set = function (name, value) { this.values[name] = value; };
function Dao(db) { return db; }

vm.runInNewContext(migrationSource, {
  migrate: function (up) { migrateUp = up; }, Dao: Dao, Collection: Collection,
  SchemaField: SchemaField, Record: Record, Date: Date, Math: Math,
  isFinite: isFinite, Error: Error,
});
assert.strictEqual(typeof migrateUp, 'function', 'migration up callback was not registered');

var created = '2026-01-01T00:00:00.000Z';
var users = Array.from({ length: 1001 }, function (_, index) {
  var id = 'user-' + String(index).padStart(4, '0');
  return { id: id, get: function (name) { return name === 'created' ? created : null; } };
});
var queryCalls = [];
var savedStates = [];
var collections = {
  users: { id: 'users', name: 'users' },
  comments: { id: 'comments', name: 'comments', schema: new FakeSchema(), indexes: [] },
};
var dao = {
  findCollectionByNameOrId: function (name) { return collections[name]; },
  saveCollection: function (collection) { collections[collection.name] = collection; },
  findRecordsByFilter: function (collection, filter, sort, limit, offset, params) {
    assert.strictEqual(collection, 'users');
    queryCalls.push({ filter: filter, sort: sort, limit: limit, offset: offset, params: params });
    var afterCreated = params && params.cursorCreated;
    var afterId = params && params.cursorId;
    return users.filter(function (user) {
      if (!afterCreated) return true;
      var userCreated = user.get('created');
      return userCreated > afterCreated || (userCreated === afterCreated && user.id > afterId);
    }).slice(0, limit);
  },
  saveRecord: function (record) { savedStates.push(record); },
};

migrateUp(dao);
assert.strictEqual(queryCalls.length, 3, 'migration must page until a short EOF page');
queryCalls.forEach(function (call) {
  assert.strictEqual(call.limit, 500, 'migration page size must remain bounded');
  assert.strictEqual(call.offset, 0, 'keyset pagination must not use a growing offset');
  assert.strictEqual(call.sort, 'created,id', 'migration sort must break equal-created ties with id');
});
assert.ok(queryCalls[1].filter.indexOf('created > {:cursorCreated}') !== -1, 'migration must advance by created cursor');
assert.ok(queryCalls[1].filter.indexOf('id > {:cursorId}') !== -1, 'migration must advance equal-created users by id');
assert.strictEqual(savedStates.length, users.length, 'every unverified user must receive one state');
assert.strictEqual(new Set(savedStates.map(function (state) { return state.values.user; })).size, users.length,
  'each unverified user must receive exactly one state');
process.stdout.write('PASS account retention migration pagination fixture\n');
