'use strict';

var DAY_MS = 24 * 60 * 60 * 1000;
var MAX_ROWS = 5000;
var MAX_RETENTION_ROWS = 100;
var ARCHIVE_KEYS = ['schema_version','event_id','created_at','category','source_kind','result','duration_ms','attempt','error_class'];
var CATEGORIES = ['account_verification','account_password_reset','account_email_change','reader_otp','comment_new','comment_approved','comment_reply','admin_test','ops_alert','account_retention_notice'];
var SOURCE_KINDS = ['account','reader','comment','admin','operations','retention','registration'];
var RESULTS = ['sent','failed'];
var ERROR_CLASSES = ['NONE','MAIL_NOT_CONFIGURED','SMTP_AUTH','SMTP_CONNECTION','SMTP_TIMEOUT','RECIPIENT_TEMPORARY','RECIPIENT_PERMANENT','PAYLOAD_INVALID','RATE_LIMITED','INTERNAL_ERROR','GATEWAY_UNAVAILABLE','OUTBOX_UNAVAILABLE'];
var testDependencies = null;

function archiveError(code) { var error = new Error(code); error.code = code; return error; }
function dependencies() {
  if (testDependencies) return testDependencies;
  return {
    dao: function () { return $app.dao(); },
    runInTransaction: function (callback) { return $app.runInTransaction(callback); },
    randomBatchId: function () { return $security.randomStringWithAlphabet(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'); },
  };
}
function newRecord(dao, collection) { return typeof dao.newRecord === 'function' ? dao.newRecord(collection) : new Record(collection); }
function iso(value) { return new Date(value).toISOString(); }
function boundedLimit(value) { var number = Math.floor(Number(value)); return Math.max(1, Math.min(isFinite(number) ? number : MAX_ROWS, MAX_ROWS)); }
function enumValue(values, value, code) { var text = String(value || ''); if (values.indexOf(text) === -1) throw archiveError(code); return text; }
function boundedInteger(value, min, max, code) { var number = Number(value); if (!isFinite(number) || Math.floor(number) !== number || number < min || number > max) throw archiveError(code); return number; }
function requiredEventId(record) { var value = String(record.get('event_id') || ''); if (!/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw archiveError('ARCHIVE_INVALID_EVENT_ID'); return value; }
function validHash(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }
function requireHash(value, code) { if (!validHash(value)) throw archiveError(code); return String(value); }
function requireBatchId(value) { var text = String(value || ''); if (!/^[A-Za-z0-9_-]{16,100}$/.test(text)) throw archiveError('ARCHIVE_BATCH_ID_INVALID'); return text; }
function requireObjectKey(value) { var text = String(value || ''); if (!/^\d{4}-\d{2}\/[A-Za-z0-9_-]+\.jsonl\.gz\.age$/.test(text)) throw archiveError('ARCHIVE_OBJECT_KEY_INVALID'); return text; }
function requireIso(value, code) { var text = String(value || ''); var parsed = Date.parse(text); if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !isFinite(parsed)) throw archiveError(code); return iso(parsed); }

function findBatch(dao, batchId) {
  var rows = dao.findRecordsByFilter('mail_archive_batches', 'batch_id = {:batch}', '', 1, 0, { batch: String(batchId) }) || [];
  if (!rows.length) throw archiveError('ARCHIVE_BATCH_NOT_FOUND');
  return rows[0];
}

function projectLog(record) {
  var createdMs = Date.parse(String(record.get('created') || ''));
  if (!isFinite(createdMs)) throw archiveError('ARCHIVE_INVALID_CREATED');
  var projected = {
    schema_version: 1,
    event_id: requiredEventId(record),
    created_at: iso(createdMs),
    category: enumValue(CATEGORIES, record.get('category'), 'ARCHIVE_INVALID_CATEGORY'),
    source_kind: enumValue(SOURCE_KINDS, record.get('source_kind'), 'ARCHIVE_INVALID_SOURCE_KIND'),
    result: enumValue(RESULTS, record.get('result'), 'ARCHIVE_INVALID_RESULT'),
    duration_ms: boundedInteger(record.get('duration_ms'), 0, 600000, 'ARCHIVE_INVALID_DURATION'),
    attempt: boundedInteger(record.get('attempt'), 1, 20, 'ARCHIVE_INVALID_ATTEMPT'),
    error_class: enumValue(ERROR_CLASSES, record.get('error_class'), 'ARCHIVE_INVALID_ERROR_CLASS'),
  };
  if (Object.keys(projected).length !== ARCHIVE_KEYS.length) throw archiveError('ARCHIVE_UNKNOWN_FIELD');
  return projected;
}

function findPendingBatch(dao) {
  var rows = dao.findRecordsByFilter('mail_archive_batches', 'status != "committed"', 'created', 100, 0, {}) || [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].get('status')) !== 'committed') return rows[i];
  }
  return null;
}

function prepareBatch(nowMs, limit) {
  var deps = dependencies();
  try {
    return deps.runInTransaction(function (txDao) {
      var existing = findPendingBatch(txDao);
      if (existing) return batchDescriptor(existing);
      var cutoff = iso(Number(nowMs) - 7 * DAY_MS);
      var rows = txDao.findRecordsByFilter('mail_delivery_logs', 'archive_batch_id = null && created < {:cutoff}', 'created,event_id', boundedLimit(limit), 0, { cutoff: cutoff }) || [];
      if (!rows.length) return null;
      var batchId = deps.randomBatchId();
      var batch = newRecord(txDao, txDao.findCollectionByNameOrId('mail_archive_batches'));
      var first = rows[0]; var last = rows[rows.length - 1];
      batch.set('batch_id', batchId);
      batch.set('status', 'prepared');
      batch.set('active_slot', 'active');
      batch.set('cursor', JSON.stringify({ created_at: last.get('created'), event_id: last.get('event_id') }));
      batch.set('row_count', rows.length);
      batch.set('min_created_at', iso(Date.parse(String(first.get('created')))));
      batch.set('max_created_at', iso(Date.parse(String(last.get('created')))));
      batch.set('prepared_at', iso(nowMs));
      batch.set('last_error_class', '');
      txDao.saveRecord(batch);
      for (var i = 0; i < rows.length; i++) { rows[i].set('archive_batch_id', batchId); txDao.saveRecord(rows[i]); }
      return batchDescriptor(batch);
    });
  } catch (error) {
    var raced = getPendingBatch();
    if (raced) return raced;
    throw error;
  }
}

function exportBatch(batchId) {
  var dao = dependencies().dao();
  var batch = findBatch(dao, batchId);
  var logs = dao.findRecordsByFilter('mail_delivery_logs', 'archive_batch_id = {:batch}', 'created,event_id', MAX_ROWS, 0, { batch: String(batchId) }) || [];
  if (logs.length !== Number(batch.get('row_count'))) throw archiveError('ARCHIVE_ROW_COUNT_MISMATCH');
  return {
    batch_id: String(batchId), status: String(batch.get('status')), cursor: String(batch.get('cursor')),
    min_created_at: String(batch.get('min_created_at')), max_created_at: String(batch.get('max_created_at')),
    rows: logs.map(projectLog),
  };
}

function batchDescriptor(batch) {
  var keys = ['batch_id','status','cursor','row_count','min_created_at','max_created_at','plaintext_sha256','gzip_sha256','cipher_sha256','cipher_size','age_recipient_fingerprint','object_key','manifest_sha256','prepared_at','sealed_at','uploaded_at','committed_at'];
  var output = {};
  for (var i = 0; i < keys.length; i++) output[keys[i]] = batch.get(keys[i]) || null;
  return output;
}

function getPendingBatch() {
  var batch = findPendingBatch(dependencies().dao());
  return batch ? batchDescriptor(batch) : null;
}

function getBatchStatus(batchId) {
  return batchDescriptor(findBatch(dependencies().dao(), batchId));
}

function sealBatch(batchId, input, nowMs) {
  return dependencies().runInTransaction(function (txDao) {
    var batch = findBatch(txDao, batchId);
    if (String(batch.get('status')) !== 'prepared') throw archiveError('ARCHIVE_INVALID_TRANSITION');
    var objectKey = String(input.object_key || '');
    if (!/^\d{4}-\d{2}\/[A-Za-z0-9_-]+\.jsonl\.gz\.age$/.test(objectKey)) throw archiveError('ARCHIVE_OBJECT_KEY_INVALID');
    batch.set('plaintext_sha256', requireHash(input.plaintext_sha256, 'ARCHIVE_PLAINTEXT_HASH_INVALID'));
    batch.set('gzip_sha256', requireHash(input.gzip_sha256, 'ARCHIVE_GZIP_HASH_INVALID'));
    batch.set('cipher_sha256', requireHash(input.cipher_sha256, 'ARCHIVE_CIPHER_HASH_INVALID'));
    batch.set('cipher_size', boundedInteger(input.cipher_size, 1, Number.MAX_SAFE_INTEGER, 'ARCHIVE_CIPHER_SIZE_INVALID'));
    batch.set('age_recipient_fingerprint', String(input.age_recipient_fingerprint || ''));
    batch.set('object_key', objectKey);
    batch.set('status', 'sealed'); batch.set('sealed_at', iso(nowMs)); txDao.saveRecord(batch);
    return { batch_id: String(batchId), status: 'sealed' };
  });
}

function confirmedValuesMatch(batch, input) {
  return String(batch.get('cipher_sha256')) === String(input.cipher_sha256 || '') &&
    String(batch.get('object_key')) === String(input.object_key || '') &&
    String(batch.get('manifest_sha256')) === String(input.manifest_sha256 || '');
}

function markUploaded(batchId, input, nowMs) {
  return dependencies().runInTransaction(function (txDao) {
    var batch = findBatch(txDao, batchId);
    if (String(batch.get('status')) === 'uploaded' && confirmedValuesMatch(batch, input)) return { batch_id: String(batchId), status: 'uploaded', idempotent: true };
    if (String(batch.get('status')) !== 'sealed') throw archiveError('ARCHIVE_INVALID_TRANSITION');
    if (String(batch.get('cipher_sha256')) !== String(input.cipher_sha256 || '') || String(batch.get('object_key')) !== String(input.object_key || '')) throw archiveError('ARCHIVE_COMMIT_MISMATCH');
    batch.set('manifest_sha256', requireHash(input.manifest_sha256, 'ARCHIVE_MANIFEST_HASH_INVALID'));
    batch.set('status', 'uploaded'); batch.set('uploaded_at', iso(nowMs)); txDao.saveRecord(batch);
    return { batch_id: String(batchId), status: 'uploaded' };
  });
}

function commitBatch(batchId, input, nowMs) {
  return dependencies().runInTransaction(function (txDao) {
    var batch = findBatch(txDao, batchId);
    var status = String(batch.get('status'));
    if ((status === 'uploaded' || status === 'committed') && !confirmedValuesMatch(batch, input)) throw archiveError('ARCHIVE_COMMIT_MISMATCH');
    if (status === 'committed') return { batch_id: String(batchId), status: 'committed', deleted: Number(batch.get('row_count')), idempotent: true };
    if (status !== 'uploaded') throw archiveError('ARCHIVE_INVALID_TRANSITION');
    var logs = txDao.findRecordsByFilter('mail_delivery_logs', 'archive_batch_id = {:batch}', 'created,event_id', MAX_ROWS, 0, { batch: String(batchId) }) || [];
    if (logs.length !== Number(batch.get('row_count'))) throw archiveError('ARCHIVE_ROW_COUNT_MISMATCH');
    for (var i = 0; i < logs.length; i++) txDao.deleteRecord(logs[i]);
    batch.set('status', 'committed'); batch.set('active_slot', ''); batch.set('committed_at', iso(nowMs)); batch.set('last_error_class', ''); txDao.saveRecord(batch);
    return { batch_id: String(batchId), status: 'committed', deleted: logs.length, idempotent: false };
  });
}

function restoreDescriptor(batchId) {
  var batch = findBatch(dependencies().dao(), batchId);
  if (String(batch.get('status')) !== 'committed') throw archiveError('ARCHIVE_RESTORE_NOT_COMMITTED');
  return {
    batchId: String(batch.get('batch_id')),
    objectKey: requireObjectKey(batch.get('object_key')),
    cipherSha256: requireHash(batch.get('cipher_sha256'), 'ARCHIVE_CIPHER_HASH_INVALID'),
    manifestSha256: requireHash(batch.get('manifest_sha256'), 'ARCHIVE_MANIFEST_HASH_INVALID'),
    ageRecipientFingerprint: String(batch.get('age_recipient_fingerprint') || ''),
    rowCount: boundedInteger(batch.get('row_count'), 1, MAX_ROWS, 'ARCHIVE_ROW_COUNT_INVALID'),
    cursor: String(batch.get('cursor') || ''),
  };
}

function retentionLimit(value) {
  var number = Math.floor(Number(value));
  return Math.max(1, Math.min(isFinite(number) ? number : MAX_RETENTION_ROWS, MAX_RETENTION_ROWS));
}

function retentionDue(cutoffIso, limit, cursor, nowMs) {
  var cutoff = requireIso(cutoffIso, 'ARCHIVE_RETENTION_CUTOFF_INVALID');
  var currentMs = Number(nowMs == null ? Date.now() : nowMs);
  if (!isFinite(currentMs) || Date.parse(cutoff) > currentMs - 90 * DAY_MS) throw archiveError('ARCHIVE_RETENTION_CUTOFF_TOO_NEW');
  var after = String(cursor || '');
  if (after && !/^[A-Za-z0-9_-]{16,100}$/.test(after)) throw archiveError('ARCHIVE_RETENTION_CURSOR_INVALID');
  var pageSize = retentionLimit(limit);
  var filter = 'status = "committed" && retention_confirmed_at = null && max_created_at < {:cutoff}';
  var params = { cutoff: cutoff };
  if (after) { filter += ' && batch_id > {:cursor}'; params.cursor = after; }
  var rows = dependencies().dao().findRecordsByFilter('mail_archive_batches', filter, 'batch_id', pageSize + 1, 0, params) || [];
  var hasMore = rows.length > pageSize;
  if (hasMore) rows = rows.slice(0, pageSize);
  var items = rows.map(function (batch) {
    var objectKey = requireObjectKey(batch.get('object_key'));
    return {
      batchId: requireBatchId(batch.get('batch_id')),
      maxCreatedAt: requireIso(batch.get('max_created_at'), 'ARCHIVE_RETENTION_DATE_INVALID'),
      objectKey: objectKey,
      cipherSha256: requireHash(batch.get('cipher_sha256'), 'ARCHIVE_CIPHER_HASH_INVALID'),
      manifestObjectKey: objectKey + '.manifest.json',
    };
  });
  return { items: items, cursor: hasMore && items.length ? items[items.length - 1].batchId : null };
}

function confirmRetention(input, nowMs) {
  var batchId = requireBatchId(input && input.batchId);
  var objectKey = requireObjectKey(input && input.objectKey);
  var cipherHash = requireHash(input && input.cipherSha256, 'ARCHIVE_CIPHER_HASH_INVALID');
  return dependencies().runInTransaction(function (txDao) {
    var batch = findBatch(txDao, batchId);
    if (String(batch.get('status')) !== 'committed') throw archiveError('ARCHIVE_RETENTION_NOT_COMMITTED');
    if (String(batch.get('object_key')) !== objectKey || String(batch.get('cipher_sha256')) !== cipherHash) throw archiveError('ARCHIVE_RETENTION_MISMATCH');
    var maxCreatedMs = Date.parse(String(batch.get('max_created_at') || ''));
    var currentMs = Number(nowMs);
    if (!isFinite(maxCreatedMs) || !isFinite(currentMs) || maxCreatedMs >= currentMs - 90 * DAY_MS) throw archiveError('ARCHIVE_RETENTION_NOT_DUE');
    if (batch.get('retention_confirmed_at')) return { batchId: batchId, status: 'retention_confirmed', idempotent: true };
    batch.set('retention_confirmed_at', iso(currentMs));
    txDao.saveRecord(batch);
    return { batchId: batchId, status: 'retention_confirmed', idempotent: false };
  });
}

function setDependenciesForTests(value) { testDependencies = value; }
function resetDependenciesForTests() { testDependencies = null; }

module.exports = {
  ARCHIVE_KEYS: ARCHIVE_KEYS, projectLog: projectLog, prepareBatch: prepareBatch, exportBatch: exportBatch,
  getPendingBatch: getPendingBatch, getBatchStatus: getBatchStatus,
  sealBatch: sealBatch, markUploaded: markUploaded, commitBatch: commitBatch,
  restoreDescriptor: restoreDescriptor,
  retentionDue: retentionDue, confirmRetention: confirmRetention,
  _setDependenciesForTests: setDependenciesForTests, _resetDependenciesForTests: resetDependenciesForTests,
};
