'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');

function fail(message) { throw new Error(message); }
function assert(value, message) { if (!value) fail(message); }
function assertEqual(actual, expected, message) {
  if (actual !== expected) fail(message + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function assertThrowsCode(action, code, message) {
  try { action(); } catch (error) {
    assertEqual(error.code, code, message);
    return;
  }
  fail(message + ': expected throw ' + code);
}
function read(relativePath) { return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); }

function record(collectionName, id, values) {
  return {
    id: id,
    collection: { name: collectionName, id: collectionName },
    values: Object.assign({}, values || {}),
    get: function (key) { return this.values[key]; },
    set: function (key, value) { this.values[key] = value; },
  };
}

function createDao() {
  var tables = {
    mail_archive_request_nonces: [],
    mail_archive_batches: [],
    mail_delivery_logs: [],
  };
  var sequence = 0;
  return {
    tables: tables,
    findCollectionByNameOrId: function (name) { return { name: name, id: name }; },
    newRecord: function (collection) { return record(collection.name, 'new-' + (++sequence), {}); },
    saveRecord: function (item) {
      var table = tables[item.collection.name];
      if (table.indexOf(item) === -1) table.push(item);
    },
    deleteRecord: function (item) {
      var table = tables[item.collection.name];
      var index = table.indexOf(item);
      if (index !== -1) table.splice(index, 1);
    },
    findRecordById: function (collection, id) {
      var found = tables[collection].filter(function (item) { return item.id === id || item.get('batch_id') === id; })[0];
      if (!found) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      return found;
    },
    findFirstRecordByFilter: function (collection, filter, params) {
      var rows = this.findRecordsByFilter(collection, filter, '', 1, 0, params);
      if (!rows.length) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      return rows[0];
    },
    findRecordsByFilter: function (collection, filter, sort, limit, offset, params) {
      var rows = tables[collection].slice();
      if (collection === 'mail_archive_request_nonces') {
        if (filter.indexOf('nonce =') !== -1) rows = rows.filter(function (item) { return item.get('nonce') === params.nonce; });
        if (filter.indexOf('expires_at <') !== -1) rows = rows.filter(function (item) { return Date.parse(item.get('expires_at')) < Date.parse(params.now); });
      } else if (collection === 'mail_archive_batches') {
        if (filter.indexOf('batch_id =') !== -1) rows = rows.filter(function (item) { return item.get('batch_id') === params.batch; });
      } else if (collection === 'mail_delivery_logs') {
        if (filter.indexOf('archive_batch_id = null') !== -1) rows = rows.filter(function (item) { return !item.get('archive_batch_id'); });
        else if (filter.indexOf('archive_batch_id =') !== -1) rows = rows.filter(function (item) { return item.get('archive_batch_id') === params.batch; });
        if (filter.indexOf('created <') !== -1) rows = rows.filter(function (item) { return Date.parse(item.get('created')) < Date.parse(params.cutoff); });
        rows.sort(function (a, b) {
          var byCreated = Date.parse(a.get('created')) - Date.parse(b.get('created'));
          return byCreated || String(a.get('event_id')).localeCompare(String(b.get('event_id')));
        });
      }
      return rows.slice(offset || 0, (offset || 0) + limit);
    },
  };
}

function security() {
  return {
    sha256: function (value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); },
    hs256: function (value, secret) { return crypto.createHmac('sha256', secret).update(String(value)).digest('hex'); },
    equal: function (left, right) {
      var a = Buffer.from(String(left)); var b = Buffer.from(String(right));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

function signedRequest(sec, secret, nowMs, nonce, method, requestPath, body) {
  var timestamp = String(nowMs);
  var bodySha256 = sec.sha256(body);
  var canonical = [timestamp, nonce, method.toUpperCase(), requestPath, bodySha256].join('\n');
  return {
    timestamp: timestamp,
    nonce: nonce,
    method: method,
    path: requestPath,
    rawBody: body,
    bodySha256: bodySha256,
    signature: sec.hs256(canonical, secret),
  };
}

function run() {
  var migration = read('pb_migrations/20260716121000_create_mail_archive_state.pb.js');
  [
    'mail_archive_batches', 'mail_archive_request_nonces', 'batch_id', 'status', 'cursor',
    'row_count', 'plaintext_sha256', 'gzip_sha256', 'cipher_sha256', 'cipher_size',
    'age_recipient_fingerprint', 'object_key', 'manifest_sha256', 'prepared_at',
    'sealed_at', 'uploaded_at', 'committed_at', 'last_error_class', 'archive_batch_id',
    'idx_mail_archive_nonce_expiry', 'idx_mail_delivery_logs_archive_batch',
  ].forEach(function (needle) { assert(migration.indexOf(needle) !== -1, 'archive migration missing ' + needle); });

  var dao = createDao();
  var sec = security();
  var secret = 'fixture-archive-hmac-secret-at-least-32-characters';
  var now = Date.UTC(2026, 6, 16, 12, 0, 0);
  var authPath = path.join(repoRoot, 'pb_hooks', 'lib', 'mail_archive_auth.js');
  var auth = require(authPath);
  auth._setDependenciesForTests({ security: sec, secret: secret, runInTransaction: function (fn) { return fn(dao); } });

  var valid = signedRequest(sec, secret, now, 'nonce-fixture-0001', 'POST', '/api/internal/mail-archive/prepare', '{"limit":5000}');
  assertEqual(auth.authenticateSignedJson(dao, valid, now).limit, 5000, 'valid signed body authenticates');
  assertThrowsCode(function () { auth.authenticateSignedJson(dao, valid, now); }, 'ARCHIVE_NONCE_REPLAY', 'nonce replay is rejected');

  delete require.cache[require.resolve(authPath)];
  auth = require(authPath);
  auth._setDependenciesForTests({ security: sec, secret: secret, runInTransaction: function (fn) { return fn(dao); } });
  assertThrowsCode(function () { auth.authenticateSignedJson(dao, valid, now); }, 'ARCHIVE_NONCE_REPLAY', 'nonce replay survives process restart');

  var stale = signedRequest(sec, secret, now - 301000, 'nonce-fixture-stale', 'POST', '/api/internal/mail-archive/prepare', '{}');
  assertThrowsCode(function () { auth.authenticateSignedJson(dao, stale, now); }, 'ARCHIVE_TIMESTAMP_SKEW', 'timestamp skew is rejected');
  var mismatch = signedRequest(sec, secret, now, 'nonce-fixture-mismatch', 'POST', '/api/internal/mail-archive/prepare', '{bad json');
  mismatch.bodySha256 = sec.sha256('different body');
  assertThrowsCode(function () { auth.authenticateSignedJson(dao, mismatch, now); }, 'ARCHIVE_BODY_HASH_MISMATCH', 'body hash is checked before JSON parsing');
  var expiredNonce = record('mail_archive_request_nonces', 'expired-nonce-row', { nonce: 'nonce-expired-fixture', expires_at: new Date(now - 1).toISOString() });
  dao.tables.mail_archive_request_nonces.push(expiredNonce);
  assertEqual(auth.cleanupExpiredNonces(dao, now, 100), 1, 'expired nonces are cleaned in a bounded batch');
  assert(dao.tables.mail_archive_request_nonces.indexOf(expiredNonce) === -1, 'expired nonce row is removed');
  assert(dao.tables.mail_archive_request_nonces.some(function (item) { return item.get('nonce') === valid.nonce; }), 'unexpired replay nonce remains durable');

  var archive = require(path.join(repoRoot, 'pb_hooks', 'lib', 'mail_archive.js'));
  var batchSequence = 0;
  archive._setDependenciesForTests({
    dao: function () { return dao; },
    runInTransaction: function (fn) { return fn(dao); },
    randomBatchId: function () { batchSequence++; return 'batch-' + batchSequence; },
  });

  var cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (var i = 0; i < 5001; i++) {
    dao.tables.mail_delivery_logs.push(record('mail_delivery_logs', 'log-' + i, {
      event_id: 'event-' + String(i).padStart(5, '0'),
      created: new Date(cutoff - 1000 - i).toISOString(),
      category: 'account_verification', source_kind: 'account', result: 'sent',
      duration_ms: 25, attempt: 1, error_class: 'NONE', archive_batch_id: '',
    }));
  }
  dao.tables.mail_delivery_logs.push(record('mail_delivery_logs', 'at-cutoff', {
    event_id: 'event-cutoff', created: new Date(cutoff).toISOString(), category: 'account_verification',
    source_kind: 'account', result: 'sent', duration_ms: 1, attempt: 1, error_class: 'NONE', archive_batch_id: '',
  }));

  var prepared = archive.prepareBatch(now, 9000);
  assertEqual(prepared.row_count, 5000, 'prepare enforces the 5000 row cap');
  assertEqual(dao.tables.mail_delivery_logs.filter(function (item) { return item.get('archive_batch_id') === prepared.batch_id; }).length, 5000, 'prepare reserves selected rows transactionally');
  assertEqual(dao.tables.mail_delivery_logs.filter(function (item) { return item.id === 'at-cutoff'; })[0].get('archive_batch_id'), '', 'cutoff is strict created less-than');

  var exported = archive.exportBatch(prepared.batch_id);
  assertEqual(exported.rows.length, 5000, 'export returns the reserved batch only');
  var expectedKeys = ['attempt','category','created_at','duration_ms','error_class','event_id','result','schema_version','source_kind'];
  assertEqual(Object.keys(exported.rows[0]).sort().join(','), expectedKeys.join(','), 'archive row has only nine whitelist keys');

  var invalidLog = dao.tables.mail_delivery_logs.filter(function (item) { return item.get('archive_batch_id') === prepared.batch_id; })[0];
  invalidLog.set('category', 'client-controlled-category');
  assertThrowsCode(function () { archive.exportBatch(prepared.batch_id); }, 'ARCHIVE_INVALID_CATEGORY', 'invalid enum fails export');
  invalidLog.set('category', 'account_verification');

  assertThrowsCode(function () { archive.markUploaded(prepared.batch_id, { cipher_sha256: 'a'.repeat(64), object_key: '2026-07/batch-1.jsonl.gz.age', manifest_sha256: 'b'.repeat(64) }); }, 'ARCHIVE_INVALID_TRANSITION', 'uploaded before seal is rejected');
  var sealedInput = {
    plaintext_sha256: '1'.repeat(64), gzip_sha256: '2'.repeat(64), cipher_sha256: '3'.repeat(64),
    cipher_size: 1234, age_recipient_fingerprint: 'AGE-FINGERPRINT-1', object_key: '2026-07/batch-1.jsonl.gz.age',
  };
  archive.sealBatch(prepared.batch_id, sealedInput, now);
  assertThrowsCode(function () { archive.markUploaded(prepared.batch_id, { cipher_sha256: '4'.repeat(64), object_key: sealedInput.object_key, manifest_sha256: '5'.repeat(64) }, now); }, 'ARCHIVE_COMMIT_MISMATCH', 'uploaded transition requires sealed cipher hash');
  var uploadedInput = { cipher_sha256: sealedInput.cipher_sha256, object_key: sealedInput.object_key, manifest_sha256: '5'.repeat(64) };
  archive.markUploaded(prepared.batch_id, uploadedInput, now);
  assertThrowsCode(function () { archive.commitBatch(prepared.batch_id, { cipher_sha256: '6'.repeat(64), object_key: uploadedInput.object_key, manifest_sha256: uploadedInput.manifest_sha256 }, now); }, 'ARCHIVE_COMMIT_MISMATCH', 'commit mismatch deletes nothing');
  assertEqual(dao.tables.mail_delivery_logs.filter(function (item) { return item.get('archive_batch_id') === prepared.batch_id; }).length, 5000, 'failed commit preserves all logs');

  var committed = archive.commitBatch(prepared.batch_id, uploadedInput, now);
  assertEqual(committed.deleted, 5000, 'commit deletes exactly reserved rows');
  assertEqual(archive.commitBatch(prepared.batch_id, uploadedInput, now).idempotent, true, 'identical repeated commit returns prior success');
  assertThrowsCode(function () { archive.commitBatch(prepared.batch_id, { cipher_sha256: sealedInput.cipher_sha256, object_key: 'wrong', manifest_sha256: uploadedInput.manifest_sha256 }, now); }, 'ARCHIVE_COMMIT_MISMATCH', 'different repeated commit is rejected');
  assertThrowsCode(function () { archive.exportBatch('unknown-batch'); }, 'ARCHIVE_BATCH_NOT_FOUND', 'unknown batch is rejected');

  var routes = read('pb_hooks/mail_archive.pb.js');
  assert(routes.indexOf("var PREFIX = '/api/internal/mail-archive/'") !== -1, 'archive route prefix is fixed');
  ['prepare', 'export', 'seal', 'uploaded', 'commit'].forEach(function (route) {
    assert(routes.indexOf("route('" + route + "'") !== -1, 'missing archive route ' + route);
  });
  assert(routes.indexOf('MAIL_ARCHIVE_API_ENABLED') !== -1, 'archive API is environment gated');
  assert(routes.indexOf("code = 'ARCHIVE_AUTH_REJECTED'") !== -1, 'route hides the exact authentication mismatch');
  assert(routes.indexOf("cronAdd('mail-archive-nonce-cleanup'") !== -1, 'nonce cleanup is scheduled');

  archive._resetDependenciesForTests();
  auth._resetDependenciesForTests();
  process.stdout.write('PASS archive schema, signed auth, projection, transitions, idempotency and zero-delete guarantees\n');
}

run();
