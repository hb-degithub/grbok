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

function makeUser(id, email, verified) {
  var record = fakeRecord({ name: 'users' });
  record.id = id;
  record.values.email = email;
  record.values.verified = verified;
  record.verified = function () { return !!this.values.verified; };
  return record;
}

function makeState(id, userId, reminderDue, cleanupDue) {
  var record = fakeRecord({ name: 'account_retention_state' });
  record.id = id;
  record.values.user = userId;
  record.values.reminder_due_at = reminderDue;
  record.values.cleanup_eligible_at = cleanupDue;
  record.values.reminder_sent_at = null;
  record.values.reminder_attempts = 0;
  record.values.next_attempt_at = null;
  record.values.last_error_class = '';
  return record;
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

function runJobTests() {
  var retention = require(path.join(repoRoot, 'pb_hooks', 'lib', 'account_retention.js'));
  var now = Date.UTC(2026, 6, 16, 0, 0, 0);
  var queuedInputs = [];
  var queueResults = [];
  var deleted = [];
  var relationships = {};
  var users = {};
  var states = [];

  function addAccount(id, ageDays, verified, related) {
    users[id] = makeUser(id, id + '@fixture.invalid', verified);
    relationships[id] = !!related;
    var created = now - ageDays * retention.DAY_MS;
    var state = makeState('state-' + id, id, new Date(created + 45 * retention.DAY_MS).toISOString(), new Date(created + 60 * retention.DAY_MS).toISOString());
    states.push(state);
    return state;
  }

  var dao = {
    findCollectionByNameOrId: function (name) { return { id: name, name: name }; },
    findRecordById: function (collection, id) {
      if (collection === 'users' && users[id] && deleted.indexOf('user:' + id) === -1) return users[id];
      if (collection === 'account_retention_state') {
        return states.filter(function (s) { return s.id === id && deleted.indexOf('state:' + id) === -1; })[0];
      }
      throw new Error('not found');
    },
    findRecordsByFilter: function (collection, filter, sort, limit, offset, params) {
      if (collection === 'account_retention_state') {
        return states.filter(function (state) {
          if (deleted.indexOf('state:' + state.id) !== -1) return false;
          if (filter.indexOf('reminder_due_at') !== -1) {
            return !state.get('reminder_sent_at') && state.get('reminder_attempts') < 3 && Date.parse(state.get('reminder_due_at')) <= Date.parse(params.now) && (!state.get('next_attempt_at') || Date.parse(state.get('next_attempt_at')) <= Date.parse(params.now));
          }
          if (filter.indexOf('cleanup_eligible_at') !== -1) {
            var dueForCleanup = Date.parse(state.get('cleanup_eligible_at')) <= Date.parse(params.now);
            if (filter.indexOf('reminder_sent_at != null') !== -1) return dueForCleanup && !!state.get('reminder_sent_at');
            if (filter.indexOf('reminder_sent_at = null') !== -1) return dueForCleanup && !state.get('reminder_sent_at');
            return dueForCleanup;
          }
          return state.get('user') === params.user;
        }).slice(0, limit);
      }
      var userId = params && params.user;
      if (userId && relationships[userId] === 'error') throw new Error('simulated relationship query failure');
      if (userId && relationships[userId]) return [{ id: 'trusted-' + collection }];
      return [];
    },
    saveRecord: function () {},
    deleteRecord: function (record) {
      var kind = record.collection && record.collection.name === 'users' ? 'user:' : 'state:';
      deleted.push(kind + record.id);
    },
  };

  retention._setDependenciesForTests({
    dao: function () { return dao; },
    runInTransaction: function (callback) { return callback(dao); },
    mailOutbox: {
      enqueue: function (txDao, input) {
        queuedInputs.push(input);
        return queueResults.length ? queueResults.shift() : { queued: true };
      },
    },
    siteUrl: 'https://fixture.invalid',
  });

  var day44State = addAccount('day44', 44, false, false);
  assertEqual(retention.runDueReminders(now, 20).queued, 0, 'day 44 does not remind');
  day44State.set('reminder_sent_at', new Date(now).toISOString());
  addAccount('day45', 45, false, false);
  var firstReminder = retention.runDueReminders(now, 20);
  assertEqual(firstReminder.queued, 1, 'day 45 queues one reminder');
  assertEqual(queuedInputs[0].policy, 'account_retention_notice', 'retention uses isolated outbox policy');
  assertEqual(queuedInputs[0].template_key, 'account_retention_notice', 'retention uses fixed template');
  assertEqual(queuedInputs[0].variables.site_url, 'https://fixture.invalid', 'retention URL comes from trusted config');
  assertEqual(retention.runDueReminders(now, 20).queued, 0, 'repeated reminder job is idempotent');

  var lateReminderState = addAccount('late-reminder', 60, false, false);
  var lateReminder = retention.runDueReminders(now, 20);
  var extendedCleanup = new Date(now + 15 * retention.DAY_MS).toISOString();
  assertEqual(lateReminder.queued, 1, 'day 60 late reminder is queued once');
  assertEqual(lateReminderState.get('cleanup_eligible_at'), extendedCleanup, 'successful late reminder grants a fresh 15 day cleanup window');
  assertEqual(queuedInputs[1].variables.cleanup_date, extendedCleanup, 'late reminder email uses the extended cleanup date');
  assertEqual(retention.runDueCleanup(now, 20).deleted, 0, 'late reminder cannot be cleaned on the enqueue day');

  var retryState = addAccount('retry', 45, false, false);
  queueResults.push({ queued: false, error_class: 'TRANSIENT_PROVIDER' });
  assertEqual(retention.runDueReminders(now, 20).failed, 1, 'transient reminder failure is summarized');
  assertEqual(retryState.get('reminder_attempts'), 1, 'failed enqueue consumes one bounded attempt');
  var retryAt = Date.parse(retryState.get('next_attempt_at'));
  assert(retryAt > now && retryAt <= now + 72 * 60 * 60 * 1000, 'retry remains inside 72 hour window');
  queueResults.push({ queued: false, error_class: 'TRANSIENT_PROVIDER' }, { queued: false, error_class: 'TRANSIENT_PROVIDER' });
  retention.runDueReminders(retryAt, 20);
  retention.runDueReminders(Date.parse(retryState.get('next_attempt_at')), 20);
  assertEqual(retryState.get('reminder_attempts'), 3, 'reminder stops after three attempts');
  assertEqual(retention.runDueReminders(now + 10 * retention.DAY_MS, 20).selected, 0, 'no infinite retry after third attempt');

  addAccount('verified', 60, true, false).set('reminder_sent_at', new Date(now - retention.DAY_MS).toISOString());
  addAccount('related', 60, false, true).set('reminder_sent_at', new Date(now - retention.DAY_MS).toISOString());
  var protectedSummary = retention.runDueCleanup(now, 20);
  assertEqual(protectedSummary.protected, 2, 'verified and business-related accounts are protected');
  assert(deleted.indexOf('user:verified') === -1 && deleted.indexOf('user:related') === -1, 'protected users remain');

  addAccount('day59', 59, false, false);
  addAccount('day60', 60, false, false).set('reminder_sent_at', new Date(now - retention.DAY_MS).toISOString());
  var cleanup = retention.runDueCleanup(now, 20);
  assertEqual(cleanup.deleted, 1, 'day 60 deletes one eligible account');
  assert(deleted.indexOf('user:day60') !== -1 && deleted.indexOf('state:state-day60') !== -1, 'user and lifecycle state delete together');
  assert(deleted.indexOf('user:day59') === -1, 'day 59 account remains');
  assertEqual(retention.runDueCleanup(now, 20).deleted, 0, 'repeated cleanup is idempotent');
  assert(JSON.stringify(cleanup).indexOf('@') === -1, 'cleanup audit summary contains no email address');

  var neverNotified = addAccount('never-notified', 60, false, false);
  neverNotified.set('reminder_attempts', 3);
  var notNotifiedCleanup = retention.runDueCleanup(now, 20);
  assertEqual(notNotifiedCleanup.not_notified, 1, 'cleanup alerts when every reminder attempt failed');
  assert(deleted.indexOf('user:never-notified') === -1 && deleted.indexOf('state:state-never-notified') === -1, 'account without a successful reminder is retained');

  var queryErrorState = addAccount('queryerror', 60, false, false);
  queryErrorState.set('reminder_sent_at', new Date(now - retention.DAY_MS).toISOString());
  relationships.queryerror = 'error';
  var failedCleanup = retention.runDueCleanup(now, 20);
  assertEqual(failedCleanup.failed, 1, 'relationship query failure fails closed');
  assert(deleted.indexOf('user:queryerror') === -1 && deleted.indexOf('state:state-queryerror') === -1, 'query failure keeps user and state');
  assertEqual(queryErrorState.get('last_error_class'), 'RETENTION_RECHECK_FAILED', 'query failure records a stable aggregate error');

  var hook = read('pb_hooks/account_retention.pb.js');
  assert(hook.indexOf('ACCOUNT_RETENTION_REMINDER_ENABLED') !== -1, 'reminder schedule has an environment gate');
  assert(hook.indexOf('ACCOUNT_RETENTION_DELETE_ENABLED') !== -1, 'deletion schedule has a separate environment gate');
  assert(hook.indexOf("|| 'false'") !== -1, 'destructive schedules default disabled');

  retention._resetDependenciesForTests();
  process.stdout.write('PASS account retention reminder and cleanup jobs\n');
}

var fixture = process.argv[2] || 'schema';
if (fixture === 'schema') {
  runSchemaTests();
} else if (fixture === 'jobs') {
  runJobTests();
} else {
  fail('unknown fixture: ' + fixture);
}
