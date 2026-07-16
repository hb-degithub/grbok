'use strict';

var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');

function fail(message) {
  throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(message + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fakeRecord(collection) {
  return {
    collection: collection,
    values: {},
    set: function (key, value) { this.values[key] = value; },
    get: function (key) { return this.values[key]; },
  };
}

function runSchemaTests() {
  var retention = require(path.join(repoRoot, 'pb_hooks', 'lib', 'account_retention.js'));
  var migration = read('pb_migrations/20260716120000_create_account_retention_state.pb.js');
  var commentHook = read('pb_hooks/validate_comment.pb.js');
  var reactionHook = read('pb_hooks/validate_reaction.pb.js');

  [
    'account_retention_state', 'cleanup_eligible_at', 'reminder_due_at',
    'reminder_sent_at', 'reminder_attempts', 'next_attempt_at',
    'last_error_class', 'author_user', 'idx_comments_author_user',
  ].forEach(function (needle) {
    assert(migration.indexOf(needle) !== -1, 'migration missing ' + needle);
  });
  assert(/listRule\s*=\s*null/.test(migration), 'retention state must be private');
  assert(/createRule\s*=\s*null/.test(migration), 'retention state create must be server-only');
  assert(/updateRule\s*=\s*null/.test(migration), 'retention state update must be server-only');

  var now = Date.UTC(2026, 6, 16, 0, 0, 0);
  var saved = [];
  var txDao = {
    findCollectionByNameOrId: function (name) { return { id: name, name: name }; },
    newRecord: function (collection) { return fakeRecord(collection); },
    saveRecord: function (record) { saved.push(record); },
  };
  var user = { id: 'user-new', get: function (key) { return key === 'created' ? new Date(now).toISOString() : null; } };
  var state = retention.initializeNewUser(txDao, user, now);
  assertEqual(saved.length, 1, 'initializeNewUser saves one state');
  assertEqual(state.get('user'), 'user-new', 'state user relation');
  assertEqual(state.get('cleanup_eligible_at'), new Date(now + 60 * retention.DAY_MS).toISOString(), 'new user cleanup date');
  assertEqual(state.get('reminder_due_at'), new Date(now + 45 * retention.DAY_MS).toISOString(), 'new user reminder date');
  assertEqual(state.get('reminder_attempts'), 0, 'new user reminder attempts');
  assertEqual(state.get('reminder_sent_at'), null, 'new user reminder timestamp');

  var oldCreated = Date.UTC(2026, 0, 1, 0, 0, 0);
  var deployedAt = Date.UTC(2026, 6, 16, 0, 0, 0);
  var schedule = retention.existingUserSchedule(oldCreated, deployedAt);
  assertEqual(schedule.cleanup_eligible_at, new Date(deployedAt + 15 * retention.DAY_MS).toISOString(), 'migration deployment grace');
  assertEqual(schedule.reminder_attempts, 0, 'migration reminder attempts');
  assertEqual(schedule.reminder_sent_at, null, 'migration reminder timestamp');

  var relationshipQueries = [];
  var relationshipDao = {
    findFirstRecordByFilter: function (collection, filter, params) {
      relationshipQueries.push([collection, filter, params]);
      if (collection === 'comments') return { id: 'comment-1' };
      throw new Error('not found');
    },
  };
  assertEqual(retention.hasBusinessRelationship(relationshipDao, { id: 'user-related' }), true, 'trusted comment relation protects user');
  assert(relationshipQueries.some(function (q) { return q[0] === 'comments' && q[1] === 'author_user = {:user}'; }), 'comment relation query is trusted relation');
  assert(!relationshipQueries.some(function (q) { return q[1].indexOf('email') !== -1; }), 'email-only data is never a trusted relationship');

  assert(commentHook.indexOf("record.set('author_user', ownerUser.id)") !== -1, 'authenticated matching comment is bound server-side');
  assert(commentHook.indexOf("record.set('author_user', '')") !== -1, 'untrusted comment relation is cleared server-side');
  assert(commentHook.indexOf('onRecordBeforeUpdateRequest') !== -1, 'comment updates also protect author_user');
  assert(commentHook.indexOf("e.record.set('author_user', originalAuthorUser)") !== -1, 'comment updates preserve the trusted server relation');
  assert(commentHook.indexOf('X-Forwarded-For') === -1, 'comment hook must not read X-Forwarded-For');
  assert(commentHook.indexOf('X-Real-IP') === -1, 'comment hook must not read X-Real-IP');
  assert(reactionHook.indexOf("record.set('user_id', auth.id)") !== -1, 'authenticated reaction relation is forced server-side');
  assert(reactionHook.indexOf('Anonymous reactions cannot set user_id') !== -1, 'anonymous client relation is rejected');

  process.stdout.write('PASS account retention schema and trusted relationships\n');
}

var fixture = process.argv[2] || 'schema';
if (fixture === 'schema') {
  runSchemaTests();
} else {
  fail('unknown fixture: ' + fixture);
}
