'use strict';

var rateLimit = require('./security_rate_limit.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');
var templates = require('./mail_templates.js');
var ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200];
var LEASE_MS = 180000;
var MAX_BATCH = 5;

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
  record.set('lease_until', ''); record.set('lease_token', ''); record.set('last_error_class', '');
  try { txDao.saveRecord(record); }
  catch (error) {
    existing = findDedupe(txDao, dedupeKey);
    if (existing) return { queued: false, outboxId: existing.id };
    throw error;
  }
  return { queued: true, outboxId: record.id };
}
function leaseBatch(nowMs, limit) {
  var leased = [];
  var batchSize = Math.max(1, Math.min(MAX_BATCH, Number(limit) || MAX_BATCH));
  var now = new Date(nowMs).toISOString().replace('T', ' ');
  $app.dao().runInTransaction(function (txDao) {
    while (leased.length < batchSize) {
      var rows = txDao.findRecordsByFilter(
        'mail_outbox',
        'status = "pending" || (status = "retry" && next_attempt_at <= {:now}) || (status = "processing" && lease_until <= {:now})',
        'created', batchSize - leased.length, 0, { now: now }
      );
      if (!rows.length) break;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getInt('attempt') >= 5) {
          rows[i].set('status', 'failed'); rows[i].set('lease_until', ''); rows[i].set('lease_token', '');
          rows[i].set('recipient', ''); rows[i].set('variables_json', {}); rows[i].set('last_error_class', 'INTERNAL_ERROR');
          txDao.saveRecord(rows[i]);
          continue;
        }
        var leaseToken = $security.randomStringWithAlphabet(32, ALPHABET);
        rows[i].set('status', 'processing'); rows[i].set('lease_until', new Date(nowMs + LEASE_MS).toISOString()); rows[i].set('lease_token', leaseToken);
        rows[i].set('attempt', rows[i].getInt('attempt') + 1); txDao.saveRecord(rows[i]);
        leased.push({ id: rows[i].id, leaseToken: leaseToken });
      }
    }
  });
  return leased;
}
function renewLease(id, leaseToken, nowMs) {
  var renewed = false;
  $app.dao().runInTransaction(function (txDao) {
    var record;
    try { record = txDao.findRecordById('mail_outbox', id); } catch (_) { return; }
    if (record.getString('status') !== 'processing' || record.getString('lease_token') !== String(leaseToken || '')) return;
    record.set('lease_until', new Date(nowMs + LEASE_MS).toISOString()); txDao.saveRecord(record); renewed = true;
  });
  return renewed;
}
function recordVariables(record) {
  var raw = record.getString('variables_json');
  var value = raw ? JSON.parse(raw) : record.get('variables_json');
  if (typeof value === 'string') value = JSON.parse(value || '{}');
  return value || {};
}
function render(record) {
  var vars = recordVariables(record);
  if (record.getString('template_key') === 'account_retention_notice') {
    var displayName = string(vars.displayName, 80, 'displayName');
    var cleanupDate = string(vars.cleanupDate, 80, 'cleanupDate');
    return {
      subject: '请验证你的博客账户',
      html: '<h2>账户验证提醒</h2><p>' + templates.escapeHtml(displayName) + '，你的账户仍未完成邮箱验证。</p><p>如不再需要，该账户预计将在 ' + templates.escapeHtml(cleanupDate) + ' 后按保留规则清理。</p>',
      text: '账户验证提醒\n' + displayName + '，你的账户仍未完成邮箱验证。\n如不再需要，该账户预计将在 ' + cleanupDate + ' 后按保留规则清理。',
    };
  }
  if (record.getString('template_key') !== 'comment_new') invalid('unsupported template');
  var subject = '新评论: ' + string(vars.postTitle, 160, 'postTitle');
  var html = '<h2>你的文章收到新评论</h2><p><strong>文章:</strong> ' + templates.escapeHtml(vars.postTitle) +
    '</p><p><strong>评论者:</strong> ' + templates.escapeHtml(vars.commenter) + '</p><blockquote>' +
    templates.escapeHtml(vars.content) + '</blockquote><p><a href="' + templates.escapeHtml(vars.postUrl) + '">查看文章</a></p>';
  var text = '你的文章收到新评论\n文章: ' + vars.postTitle + '\n评论者: ' + vars.commenter + '\n\n' + vars.content + '\n\n' + vars.postUrl;
  return { subject: subject.slice(0, 255), html: html, text: text };
}
function stableError(error) {
  var code = String(error && error.code || 'INTERNAL_ERROR').toUpperCase();
  var allowed = { MAIL_NOT_CONFIGURED: true, SMTP_AUTH: true, SMTP_CONNECTION: true, SMTP_TIMEOUT: true, RECIPIENT_TEMPORARY: true, RECIPIENT_PERMANENT: true, PAYLOAD_INVALID: true, RATE_LIMITED: true, INTERNAL_ERROR: true };
  return allowed[code] ? code : 'INTERNAL_ERROR';
}
function finish(id, leaseToken, nowMs, result, errorClass, retryable) {
  var finished = false;
  $app.dao().runInTransaction(function (txDao) {
    var record = txDao.findRecordById('mail_outbox', id);
    if (record.getString('status') !== 'processing' || record.getString('lease_token') !== String(leaseToken || '')) return;
    var attempt = record.getInt('attempt');
    if (result === 'sent') record.set('status', 'sent');
    else if (retryable && attempt < 5) {
      record.set('status', 'retry'); record.set('next_attempt_at', new Date(nowMs + BACKOFF_SECONDS[attempt - 1] * 1000).toISOString());
    } else record.set('status', 'failed');
    record.set('lease_until', ''); record.set('lease_token', ''); record.set('last_error_class', errorClass);
    if (record.getString('status') === 'sent' || record.getString('status') === 'failed') { record.set('recipient', ''); record.set('variables_json', {}); }
    txDao.saveRecord(record); finished = true;
  });
  return finished;
}
function processBatch(nowMs, limit) {
  var leases = leaseBatch(nowMs, limit); var summary = { leased: leases.length, sent: 0, failed: 0, retry: 0 };
  for (var i = 0; i < leases.length; i++) {
    if (!renewLease(leases[i].id, leases[i].leaseToken, Date.now())) continue;
    var record = $app.dao().findRecordById('mail_outbox', leases[i].id);
    var rendered; var result = 'failed'; var errorClass = 'INTERNAL_ERROR'; var retryable = false;
    try {
      rendered = render(record);
      gateway.send({ requestId: record.getString('event_id') + '_' + record.getInt('attempt'), messageId: record.getString('event_id'), category: record.getString('category'), to: record.getString('recipient'), subject: rendered.subject, html: rendered.html, text: rendered.text });
      result = 'sent'; errorClass = 'NONE'; summary.sent++;
    } catch (error) {
      errorClass = stableError(error); retryable = Boolean(error && error.retryable);
      if (retryable && record.getInt('attempt') < 5) summary.retry++; else summary.failed++;
    }
    if (finish(record.id, leases[i].leaseToken, nowMs, result, errorClass, retryable)) {
      try { logs.delivery({ event_id: $security.randomStringWithAlphabet(22, ALPHABET), category: record.getString('category') === 'comment_notification' ? 'comment_new' : 'account_retention_notice', source_kind: record.getString('category') === 'comment_notification' ? 'comment' : 'retention', result: result, duration_ms: 0, attempt: record.getInt('attempt'), error_class: errorClass }); } catch (_) {}
    }
  }
  return summary;
}
module.exports = { enqueue: enqueue, processBatch: processBatch, _leaseBatch: leaseBatch, _renewLease: renewLease, _render: render };
