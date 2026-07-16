'use strict';

var rateLimit = require('./security_rate_limit.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');
var templates = require('./mail_templates.js');
var ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200];

function invalid(message) { throw new Error(message || 'invalid outbox input'); }
function string(value, max, name) {
  var text = String(value || '').trim();
  if (!text || text.length > max) invalid('invalid ' + name);
  return text;
}
function variables(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalid variables');
  var allowed = { postTitle: true, commenter: true, content: true, postUrl: true, displayName: true, cleanupDate: true };
  var result = {};
  var keys = Object.keys(value);
  if (!keys.length || keys.length > 6) invalid('invalid variables');
  for (var i = 0; i < keys.length; i++) {
    if (!allowed[keys[i]]) invalid('invalid variable');
    result[keys[i]] = string(value[keys[i]], keys[i] === 'content' ? 2000 : 500, keys[i]);
  }
  if (JSON.stringify(result).length > 16384) invalid('variables too large');
  return result;
}
function findDedupe(dao, key) {
  var rows = dao.findRecordsByFilter('mail_outbox', 'dedupe_key = {:key}', '', 2, 0, { key: key });
  if (rows.length > 1) invalid('duplicate outbox state');
  return rows.length ? rows[0] : null;
}
function enqueue(txDao, input) {
  if (!txDao || !input || typeof input !== 'object') invalid();
  var dedupeKey = string(input.dedupeKey, 180, 'dedupeKey');
  var existing = findDedupe(txDao, dedupeKey);
  if (existing) return { queued: false, outboxId: existing.id };
  var category = string(input.category, 64, 'category');
  if (category !== 'comment_notification' && category !== 'account_retention_notice') invalid('invalid category');
  var policyKey = category;
  var limit = rateLimit.consume(txDao, { nowMs: Date.now(), entries: [
    { policyKey: policyKey, subject: 'v1' }, { policyKey: 'outbound_global', subject: 'v1' },
  ] });
  if (!limit.allowed) return { queued: false, outboxId: null, limited: true };
  var templateKey = string(input.templateKey, 64, 'templateKey');
  if ((category === 'comment_notification' && templateKey !== 'comment_new') ||
      (category === 'account_retention_notice' && templateKey !== 'account_retention_notice')) invalid('invalid template');
  var record = new Record(txDao.findCollectionByNameOrId('mail_outbox'));
  record.set('dedupe_key', dedupeKey);
  record.set('event_id', $security.randomStringWithAlphabet(22, ALPHABET));
  record.set('status', 'pending'); record.set('category', category); record.set('template_key', templateKey);
  record.set('recipient', string(input.recipient, 320, 'recipient'));
  record.set('variables_json', variables(input.variables));
  record.set('attempt', 0); record.set('next_attempt_at', new Date().toISOString());
  record.set('lease_until', ''); record.set('last_error_class', '');
  try { txDao.saveRecord(record); }
  catch (error) {
    existing = findDedupe(txDao, dedupeKey);
    if (existing) return { queued: false, outboxId: existing.id };
    throw error;
  }
  return { queued: true, outboxId: record.id };
}
function parseDate(value) {
  var ms = new Date(String(value || '').replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
function leaseBatch(nowMs, limit) {
  var leased = [];
  $app.dao().runInTransaction(function (txDao) {
    var rows = txDao.findRecordsByFilter('mail_outbox', 'status = "pending" || status = "retry" || status = "processing"', 'created', 100, 0);
    for (var i = 0; i < rows.length && leased.length < Math.max(1, Math.min(25, Number(limit) || 10)); i++) {
      var status = rows[i].getString('status');
      var eligible = status === 'pending' || (status === 'retry' && parseDate(rows[i].getString('next_attempt_at')) <= nowMs) ||
        (status === 'processing' && parseDate(rows[i].getString('lease_until')) <= nowMs);
      if (!eligible) continue;
      rows[i].set('status', 'processing'); rows[i].set('lease_until', new Date(nowMs + 60000).toISOString());
      rows[i].set('attempt', rows[i].getInt('attempt') + 1); txDao.saveRecord(rows[i]);
      leased.push(rows[i].id);
    }
  });
  return leased;
}
function recordVariables(record) {
  var raw = record.getString('variables_json');
  var value = raw ? JSON.parse(raw) : record.get('variables_json');
  if (typeof value === 'string') value = JSON.parse(value || '{}');
  return value || {};
}
function render(record) {
  var vars = recordVariables(record);
  if (record.getString('template_key') !== 'comment_new') invalid('unsupported template');
  var subject = '新评论: ' + string(vars.postTitle, 160, 'postTitle');
  var html = '<h2>你的文章收到新评论</h2><p><strong>文章:</strong> ' + templates.escapeHtml(vars.postTitle) +
    '</p><p><strong>评论者:</strong> ' + templates.escapeHtml(vars.commenter) + '</p><blockquote>' +
    templates.escapeHtml(vars.content) + '</blockquote><p><a href="' + templates.escapeHtml(vars.postUrl) + '">查看文章</a></p>';
  var text = '你的文章收到新评论\n文章: ' + vars.postTitle + '\n评论者: ' + vars.commenter + '\n\n' + vars.content + '\n\n' + vars.postUrl;
  return { subject: subject.slice(0, 255), html: html, text: text };
}
function stableError(error) {
  var code = String(error && error.code || 'INTERNAL_ERROR').toLowerCase();
  var allowed = { mail_not_configured: true, smtp_auth: true, smtp_connection: true, smtp_timeout: true, recipient_temporary: true, recipient_permanent: true, payload_invalid: true, rate_limited: true, internal_error: true };
  return allowed[code] ? code : 'internal_error';
}
function finish(id, nowMs, result, errorClass, retryable) {
  $app.dao().runInTransaction(function (txDao) {
    var record = txDao.findRecordById('mail_outbox', id);
    var attempt = record.getInt('attempt');
    if (result === 'sent') record.set('status', 'sent');
    else if (retryable && attempt < 5) {
      record.set('status', 'retry'); record.set('next_attempt_at', new Date(nowMs + BACKOFF_SECONDS[attempt - 1] * 1000).toISOString());
    } else record.set('status', 'failed');
    record.set('lease_until', ''); record.set('last_error_class', errorClass);
    if (record.getString('status') === 'sent' || record.getString('status') === 'failed') { record.set('recipient', ''); record.set('variables_json', {}); }
    txDao.saveRecord(record);
  });
}
function processBatch(nowMs, limit) {
  var ids = leaseBatch(nowMs, limit); var summary = { leased: ids.length, sent: 0, failed: 0, retry: 0 };
  for (var i = 0; i < ids.length; i++) {
    var record = $app.dao().findRecordById('mail_outbox', ids[i]);
    var rendered; var result = 'failed'; var errorClass = 'internal_error'; var retryable = false;
    try {
      rendered = render(record);
      gateway.send({ requestId: record.getString('event_id') + '_' + record.getInt('attempt'), messageId: record.getString('event_id'), category: record.getString('category'), to: record.getString('recipient'), subject: rendered.subject, html: rendered.html, text: rendered.text });
      result = 'sent'; errorClass = 'none'; summary.sent++;
    } catch (error) {
      errorClass = stableError(error); retryable = Boolean(error && error.retryable);
      if (retryable && record.getInt('attempt') < 5) summary.retry++; else summary.failed++;
    }
    finish(record.id, nowMs, result, errorClass, retryable);
    try { logs.delivery({ event_id: $security.randomStringWithAlphabet(22, ALPHABET), category: record.getString('category'), source_kind: record.getString('category') === 'comment_notification' ? 'comment' : 'retention', result: result, duration_ms: 0, attempt: record.getInt('attempt'), error_class: errorClass }); } catch (_) {}
  }
  return summary;
}
module.exports = { enqueue: enqueue, processBatch: processBatch, _leaseBatch: leaseBatch, _render: render };
