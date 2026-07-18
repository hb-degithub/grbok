'use strict';

var DAY_MS = 24 * 60 * 60 * 1000;
var MAX_BATCH = 100;
var testDependencies = null;

function iso(value) { return new Date(value).toISOString(); }

function recordId(record) {
  if (!record) return '';
  return String(record.id || (typeof record.get === 'function' ? record.get('id') : '') || '');
}

function collection(dao, name) { return dao.findCollectionByNameOrId(name); }

function newRecord(dao, targetCollection) {
  if (typeof dao.newRecord === 'function') return dao.newRecord(targetCollection);
  return new Record(targetCollection);
}

function existingUserSchedule(createdMs, deployedAtMs) {
  var created = Number(createdMs);
  var deployed = Number(deployedAtMs);
  if (!isFinite(created) || !isFinite(deployed)) throw new Error('invalid lifecycle timestamp');
  return {
    reminder_due_at: iso(Math.max(created + 45 * DAY_MS, deployed)),
    cleanup_eligible_at: iso(Math.max(created + 60 * DAY_MS, deployed + 15 * DAY_MS)),
    reminder_sent_at: null,
    reminder_attempts: 0,
  };
}

function initializeNewUser(txDao, userRecord, nowMs) {
  var userId = recordId(userRecord);
  if (!userId) throw new Error('user id is required');
  var state = newRecord(txDao, collection(txDao, 'account_retention_state'));
  state.set('user', userId);
  state.set('reminder_due_at', iso(nowMs + 45 * DAY_MS));
  state.set('cleanup_eligible_at', iso(nowMs + 60 * DAY_MS));
  state.set('reminder_sent_at', null);
  state.set('reminder_attempts', 0);
  state.set('next_attempt_at', null);
  state.set('last_error_class', '');
  txDao.saveRecord(state);
  return state;
}

function findState(dao, userId) {
  if (typeof dao.findFirstRecordByFilter === 'function') {
    try { return dao.findFirstRecordByFilter('account_retention_state', 'user = {:user}', { user: userId }); }
    catch (_) { return null; }
  }
  var rows = dao.findRecordsByFilter('account_retention_state', 'user = {:user}', '', 1, 0, { user: userId });
  return rows && rows.length ? rows[0] : null;
}

function cancelForVerifiedUser(dao, userRecord) {
  var state = findState(dao, recordId(userRecord));
  if (!state) return false;
  dao.deleteRecord(state);
  return true;
}

function exists(dao, targetCollection, field, userId) {
  if (typeof dao.findRecordsByFilter === 'function') {
    var rows = dao.findRecordsByFilter(targetCollection, field + ' = {:user}', '', 1, 0, { user: userId });
    return !!(rows && rows.length);
  }
  try { return !!dao.findFirstRecordByFilter(targetCollection, field + ' = {:user}', { user: userId }); }
  catch (_) { return false; }
}

function hasBusinessRelationship(dao, userRecord) {
  var userId = recordId(userRecord);
  if (!userId) throw new Error('user id is required');
  return exists(dao, 'posts', 'author', userId) ||
    exists(dao, 'comments', 'author_user', userId) ||
    exists(dao, 'media_assets', 'uploader', userId) ||
    exists(dao, 'post_versions', 'editor', userId) ||
    exists(dao, 'reactions', 'user_id', userId);
}

function bindAuthenticatedComment(record, ownerUser, authRecord) {
  record.set('author_user', '');
  if (!ownerUser || !authRecord || recordId(ownerUser) !== recordId(authRecord)) return false;
  record.set('author_user', recordId(ownerUser));
  return true;
}

function dependencies() {
  if (testDependencies) return testDependencies;
  return {
    dao: function () { return $app.dao(); },
    runInTransaction: function (callback) { return $app.runInTransaction(callback); },
    mailOutbox: require('./mail_outbox.js'),
    siteUrl: String($os.getenv('PUBLIC_SITE_URL') || ''),
  };
}

function boundedLimit(limit) {
  var value = Math.floor(Number(limit));
  if (!isFinite(value) || value < 1) return 1;
  return Math.min(value, MAX_BATCH);
}

function recordVerified(user) {
  if (!user) return false;
  if (typeof user.verified === 'function') return !!user.verified();
  return !!user.get('verified');
}

function stableErrorClass(value, fallback) {
  var text = String(value || fallback || 'RETENTION_OPERATION_FAILED').toUpperCase();
  text = text.replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return text || 'RETENTION_OPERATION_FAILED';
}

function retryDelay(attempt) {
  if (attempt <= 1) return 6 * 60 * 60 * 1000;
  if (attempt === 2) return 24 * 60 * 60 * 1000;
  return 0;
}

function retentionNoticeInput(user, nowMs, siteUrl, cleanupEligibleAt) {
  if (!siteUrl || !/^https:\/\//.test(siteUrl)) throw new Error('RETENTION_SITE_URL_INVALID');
  return {
    dedupeKey: 'account-retention:' + recordId(user),
    category: 'account_retention_notice',
    templateKey: 'account_retention_notice',
    recipient: String(user.get('email') || ''),
    variables: {
      displayName: String(user.get('name') || user.get('username') || '用户'),
      cleanupDate: String(cleanupEligibleAt || ''),
      siteUrl: siteUrl,
    },
  };
}

function loadById(dao, targetCollection, id) {
  return dao.findRecordById(targetCollection, id);
}

function runDueReminders(nowMs, limit) {
  var deps = dependencies();
  var nowIso = iso(nowMs);
  var due = deps.dao().findRecordsByFilter(
    'account_retention_state',
    'reminder_sent_at = null && reminder_due_at <= {:now} && reminder_attempts < 3 && (next_attempt_at = null || next_attempt_at <= {:now})',
    'reminder_due_at,id', boundedLimit(limit), 0, { now: nowIso }
  ) || [];
  var summary = { selected: due.length, queued: 0, cancelled: 0, failed: 0, error_classes: {} };

  for (var i = 0; i < due.length; i++) {
    (function (stateId) {
      try {
        deps.runInTransaction(function (txDao) {
          var state = loadById(txDao, 'account_retention_state', stateId);
          if (state.get('reminder_sent_at') || Number(state.get('reminder_attempts') || 0) >= 3) return;
          if (Date.parse(String(state.get('reminder_due_at'))) > nowMs) return;
          var user = loadById(txDao, 'users', String(state.get('user')));
          if (recordVerified(user) || hasBusinessRelationship(txDao, user)) {
            txDao.deleteRecord(state);
            summary.cancelled++;
            return;
          }

          var originalCleanupMs = Date.parse(String(state.get('cleanup_eligible_at') || ''));
          var extendedCleanupMs = Math.max(isFinite(originalCleanupMs) ? originalCleanupMs : 0, nowMs + 15 * DAY_MS);
          var extendedCleanupAt = iso(extendedCleanupMs);
          var result;
          try {
            result = deps.mailOutbox.enqueue(txDao, retentionNoticeInput(user, nowMs, deps.siteUrl, extendedCleanupAt));
          } catch (_) {
            result = { queued: false, error_class: 'OUTBOX_UNAVAILABLE' };
          }
          var attempt = Number(state.get('reminder_attempts') || 0) + 1;
          state.set('reminder_attempts', attempt);
          if (result && result.queued) {
            state.set('reminder_sent_at', nowIso);
            state.set('cleanup_eligible_at', extendedCleanupAt);
            state.set('next_attempt_at', null);
            state.set('last_error_class', '');
            summary.queued++;
          } else {
            var errorClass = stableErrorClass(result && result.error_class, 'RETENTION_REMINDER_FAILED');
            state.set('last_error_class', errorClass);
            state.set('next_attempt_at', attempt < 3 ? iso(nowMs + retryDelay(attempt)) : null);
            summary.failed++;
            summary.error_classes[errorClass] = (summary.error_classes[errorClass] || 0) + 1;
          }
          txDao.saveRecord(state);
        });
      } catch (_) {
        summary.failed++;
        summary.error_classes.RETENTION_TRANSACTION_FAILED = (summary.error_classes.RETENTION_TRANSACTION_FAILED || 0) + 1;
        try {
          deps.runInTransaction(function (txDao) {
            var failedState = loadById(txDao, 'account_retention_state', stateId);
            failedState.set('last_error_class', 'RETENTION_TRANSACTION_FAILED');
            txDao.saveRecord(failedState);
          });
        } catch (_) {}
      }
    })(recordId(due[i]));
  }
  return summary;
}

function runDueCleanup(nowMs, limit) {
  var deps = dependencies();
  var nowIso = iso(nowMs);
  var due = deps.dao().findRecordsByFilter(
    'account_retention_state', 'cleanup_eligible_at <= {:now} && reminder_sent_at != null',
    'cleanup_eligible_at,id', boundedLimit(limit), 0, { now: nowIso }
  ) || [];
  var notNotified = deps.dao().findRecordsByFilter(
    'account_retention_state', 'cleanup_eligible_at <= {:now} && reminder_sent_at = null',
    'cleanup_eligible_at,id', boundedLimit(limit), 0, { now: nowIso }
  ) || [];
  var summary = { selected: due.length, deleted: 0, protected: 0, not_notified: notNotified.length, failed: 0, error_classes: {} };
  if (notNotified.length) summary.error_classes.RETENTION_REMINDER_NOT_SENT = notNotified.length;

  for (var i = 0; i < due.length; i++) {
    (function (stateId) {
      try {
        deps.runInTransaction(function (txDao) {
          var state = loadById(txDao, 'account_retention_state', stateId);
          if (Date.parse(String(state.get('cleanup_eligible_at'))) > nowMs) return;
          if (!state.get('reminder_sent_at')) {
            summary.not_notified++;
            summary.error_classes.RETENTION_REMINDER_NOT_SENT = (summary.error_classes.RETENTION_REMINDER_NOT_SENT || 0) + 1;
            return;
          }
          var user = loadById(txDao, 'users', String(state.get('user')));
          if (recordVerified(user) || hasBusinessRelationship(txDao, user)) {
            txDao.deleteRecord(state);
            summary.protected++;
            return;
          }
          txDao.deleteRecord(state);
          txDao.deleteRecord(user);
          summary.deleted++;
        });
      } catch (_) {
        summary.failed++;
        summary.error_classes.RETENTION_RECHECK_FAILED = (summary.error_classes.RETENTION_RECHECK_FAILED || 0) + 1;
        try {
          deps.runInTransaction(function (txDao) {
            var failedState = loadById(txDao, 'account_retention_state', stateId);
            failedState.set('last_error_class', 'RETENTION_RECHECK_FAILED');
            txDao.saveRecord(failedState);
          });
        } catch (_) {}
      }
    })(recordId(due[i]));
  }
  return summary;
}

function setDependenciesForTests(value) { testDependencies = value; }
function resetDependenciesForTests() { testDependencies = null; }

module.exports = {
  DAY_MS: DAY_MS,
  iso: iso,
  existingUserSchedule: existingUserSchedule,
  initializeNewUser: initializeNewUser,
  cancelForVerifiedUser: cancelForVerifiedUser,
  bindAuthenticatedComment: bindAuthenticatedComment,
  hasBusinessRelationship: hasBusinessRelationship,
  runDueReminders: runDueReminders,
  runDueCleanup: runDueCleanup,
  _setDependenciesForTests: setDependenciesForTests,
  _resetDependenciesForTests: resetDependenciesForTests,
};
