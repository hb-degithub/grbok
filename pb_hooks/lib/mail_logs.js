'use strict';

var ALLOWED_FIELDS = [
  'request_id', 'category', 'source_collection', 'source_record_id',
  'recipient_masked', 'recipient_hash', 'request_ip_hash', 'result',
  'duration_ms', 'attempt', 'error_class',
];
var ALLOWED_FIELDS_SET = {};
for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
  ALLOWED_FIELDS_SET[ALLOWED_FIELDS[i]] = true;
}
var FORBIDDEN_FIELDS = ['html', 'text', 'body', 'token', 'code', 'recipient', 'ip'];
var RESULT_VALUES = ['accepted', 'sent', 'failed', 'suppressed', 'rate_limited', 'decoy'];
var RESULT_VALUES_SET = {};
for (var j = 0; j < RESULT_VALUES.length; j++) {
  RESULT_VALUES_SET[RESULT_VALUES[j]] = true;
}
var DURATION_MAX = 120000;
var ATTEMPT_MAX = 100;
var RATE_COUNT_FIELDS = ['recipient_hash', 'request_ip_hash'];
var RATE_COUNT_FIELDS_SET = {};
for (var k = 0; k < RATE_COUNT_FIELDS.length; k++) {
  RATE_COUNT_FIELDS_SET[RATE_COUNT_FIELDS[k]] = true;
}

function clampInt(value, min, max) {
  var n = Number(value);
  if (!isFinite(n) || n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function delivery(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('delivery input must be a plain object');
  }

  for (var key in input) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      if (!ALLOWED_FIELDS_SET[key]) {
        throw new Error('unknown log field: ' + key);
      }
    }
  }

  for (var f = 0; f < FORBIDDEN_FIELDS.length; f++) {
    if (Object.prototype.hasOwnProperty.call(input, FORBIDDEN_FIELDS[f])) {
      throw new Error('forbidden log field: ' + FORBIDDEN_FIELDS[f]);
    }
  }

  var required = ['request_id', 'category', 'source_collection', 'source_record_id',
    'recipient_masked', 'recipient_hash', 'request_ip_hash', 'result', 'duration_ms', 'attempt', 'error_class'];
  for (var r = 0; r < required.length; r++) {
    if (!Object.prototype.hasOwnProperty.call(input, required[r])) {
      throw new Error('missing required log field: ' + required[r]);
    }
  }

  var result = String(input.result);
  if (!RESULT_VALUES_SET[result]) {
    throw new Error('invalid result value: ' + result);
  }

  var collection = $app.dao().findCollectionByNameOrId('mail_delivery_logs');
  var record = new Record(collection);
  record.set('request_id', String(input.request_id));
  record.set('category', String(input.category));
  record.set('source_collection', String(input.source_collection));
  record.set('source_record_id', String(input.source_record_id));
  record.set('recipient_masked', String(input.recipient_masked));
  record.set('recipient_hash', String(input.recipient_hash));
  record.set('request_ip_hash', String(input.request_ip_hash));
  record.set('result', result);
  record.set('duration_ms', clampInt(input.duration_ms, 0, DURATION_MAX));
  record.set('attempt', clampInt(input.attempt, 0, ATTEMPT_MAX));
  record.set('error_class', String(input.error_class));
  $app.dao().saveRecord(record);
}

function rateCount(field, hash, sinceIso) {
  if (!RATE_COUNT_FIELDS_SET[field]) {
    throw new Error('rateCount field must be recipient_hash or request_ip_hash');
  }
  if (typeof hash !== 'string' || !hash) {
    throw new Error('rateCount hash must be a non-empty string');
  }
  if (typeof sinceIso !== 'string' || !sinceIso) {
    throw new Error('rateCount sinceIso must be a non-empty string');
  }

  var records = $app.dao().findRecordsByFilter(
    'mail_delivery_logs',
    field + ' = {:hash} && created >= {:since}',
    '-created',
    1000,
    0,
    { hash: hash, since: sinceIso }
  );
  return records ? records.length : 0;
}

module.exports = {
  delivery: delivery,
  rateCount: rateCount,
};