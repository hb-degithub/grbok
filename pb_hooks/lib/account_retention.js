'use strict';

var DAY_MS = 24 * 60 * 60 * 1000;

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

module.exports = {
  DAY_MS: DAY_MS,
  iso: iso,
  existingUserSchedule: existingUserSchedule,
  initializeNewUser: initializeNewUser,
  cancelForVerifiedUser: cancelForVerifiedUser,
  bindAuthenticatedComment: bindAuthenticatedComment,
  hasBusinessRelationship: hasBusinessRelationship,
};

