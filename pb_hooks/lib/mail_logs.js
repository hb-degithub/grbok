'use strict';

var FIELDS = ['event_id', 'category', 'source_kind', 'result', 'duration_ms', 'attempt', 'error_class'];
var FIELD_SET = {};
for (var f = 0; f < FIELDS.length; f++) FIELD_SET[FIELDS[f]] = true;
var CATEGORIES = {
  account_verification: true, account_password_reset: true, account_email_change: true,
  reader_otp: true, comment_notification: true, account_retention_notice: true,
  admin_test: true, operations_alert: true,
};
var SOURCE_KINDS = { account_mail: true, otp: true, comment: true, retention: true, admin_test: true, operations: true };
var RESULTS = { sent: true, failed: true };
var ERROR_CLASSES = {
  none: true, mail_not_configured: true, smtp_auth: true, smtp_connection: true,
  smtp_timeout: true, recipient_temporary: true, recipient_permanent: true,
  payload_invalid: true, rate_limited: true, internal_error: true,
};

function integer(value, min, max, name) {
  var number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('invalid ' + name);
  return number;
}

function delivery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('delivery input must be an object');
  var keys = Object.keys(input);
  if (keys.length !== FIELDS.length) throw new Error('delivery input fields mismatch');
  for (var i = 0; i < keys.length; i++) if (!FIELD_SET[keys[i]]) throw new Error('unknown log field: ' + keys[i]);
  var eventId = String(input.event_id || '');
  var category = String(input.category || '');
  var sourceKind = String(input.source_kind || '');
  var result = String(input.result || '');
  var errorClass = String(input.error_class || '').toLowerCase();
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(eventId)) throw new Error('invalid event_id');
  if (!CATEGORIES[category] || !SOURCE_KINDS[sourceKind] || !RESULTS[result] || !ERROR_CLASSES[errorClass]) {
    throw new Error('invalid delivery enum');
  }
  var collection = $app.dao().findCollectionByNameOrId('mail_delivery_logs');
  var record = new Record(collection);
  record.set('event_id', eventId);
  record.set('category', category);
  record.set('source_kind', sourceKind);
  record.set('result', result);
  record.set('duration_ms', integer(input.duration_ms, 0, 120000, 'duration_ms'));
  record.set('attempt', integer(input.attempt, 1, 100, 'attempt'));
  record.set('error_class', errorClass);
  record.set('archive_batch_id', '');
  $app.dao().saveRecord(record);
}

module.exports = { delivery: delivery };
