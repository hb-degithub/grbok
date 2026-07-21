'use strict';

var gateway = require('./mail_gateway.js');
var stepUp = require('./admin_step_up.js');

var QUEUE_STATUSES = ['pending', 'processing', 'retry', 'sent', 'failed', 'cancelled'];
var LOG_RESULTS = ['sent', 'failed'];
var MAX_PAGE_SIZE = 100;
var DEFAULT_PAGE_SIZE = 25;

function apiError(status, code) {
  throw new ApiError(status, code);
}

function integerParam(value, fallback, min, max) {
  var num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) return fallback;
  return num;
}

function stringParam(value) {
  var text = String(value || '').trim();
  return text;
}

function inSet(value, allowed) {
  var v = String(value || '').trim();
  return v && allowed.indexOf(v) !== -1 ? v : '';
}

function maskRecipient(email) {
  var text = String(email || '').trim();
  if (!text) return '';
  var at = text.indexOf('@');
  if (at < 1) return '***';
  var local = text.slice(0, at);
  var domain = text.slice(at + 1);
  var visible = local.slice(0, Math.min(2, local.length));
  return visible + '***@' + domain;
}

function isoToMillis(value) {
  if (!value) return 0;
  return Date.parse(String(value).replace(' ', 'T')) || 0;
}

function nowMillisMinus24h() {
  return Date.now() - 24 * 60 * 60 * 1000;
}

function countByFilter(dao, collection, filter, params) {
  try {
    var rows = dao.findRecordsByFilter(collection, filter, '', 500, 0, params || {});
    return rows.length;
  } catch (_) {
    return 0;
  }
}

function overview(c) {
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var dao = $app.dao();
  var sinceMs = nowMillisMinus24h();
  var sinceIso = new Date(sinceMs).toISOString().replace('T', ' ');

  var gatewayStatus = null;
  try {
    gatewayStatus = gateway.status();
  } catch (error) {
    gatewayStatus = { configured: false, error: String(error && error.message || 'unavailable') };
  }

  var sent24h = 0;
  var failed24h = 0;
  try {
    var sentRows = dao.findRecordsByFilter(
      'mail_delivery_logs',
      'created >= {:since} && result = {:result}',
      '', 500, 0,
      { since: sinceIso, result: 'sent' }
    );
    sent24h = sentRows.length;
  } catch (_) {}
  try {
    var failedRows = dao.findRecordsByFilter(
      'mail_delivery_logs',
      'created >= {:since} && result = {:result}',
      '', 500, 0,
      { since: sinceIso, result: 'failed' }
    );
    failed24h = failedRows.length;
  } catch (_) {}

  var pending = countByFilter(dao, 'mail_outbox', 'status = "pending"', {});
  var processing = countByFilter(dao, 'mail_outbox', 'status = "processing"', {});
  var retry = countByFilter(dao, 'mail_outbox', 'status = "retry"', {});
  var failedOutbox = countByFilter(dao, 'mail_outbox', 'status = "failed"', {});

  var total24h = sent24h + failed24h;
  var successRate = total24h > 0 ? Math.round((sent24h / total24h) * 100) : 0;

  return c.json(200, {
    gateway: gatewayStatus,
    summary: {
      sent_24h: sent24h,
      failed_24h: failed24h,
      success_rate: successRate,
      pending: pending,
      processing: processing,
      retry: retry,
      failed_outbox: failedOutbox,
    },
    checked_at: new Date().toISOString(),
  });
}

function queue(c) {
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var page = integerParam(c.queryParam('page'), 1, 1, 1000);
  var perPage = integerParam(c.queryParam('perPage'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  var status = inSet(c.queryParam('status'), QUEUE_STATUSES);
  var category = stringParam(c.queryParam('category'));

  var filter = 'id != ""';
  var params = {};
  if (status) { filter = 'status = {:status}'; params.status = status; }
  if (category) {
    filter = filter === 'id != ""' ? 'category = {:category}' : filter + ' && category = {:category}';
    params.category = category;
  }

  var offset = (page - 1) * perPage;
  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter('mail_outbox', filter, '-created', perPage, offset, params);
  } catch (_) {}

  var items = rows.map(function (r) {
    return {
      id: r.id,
      status: r.getString('status'),
      category: r.getString('category'),
      template_key: r.getString('template_key'),
      recipient_masked: maskRecipient(r.getString('recipient')),
      attempt: r.getInt('attempt'),
      next_attempt_at: r.getString('next_attempt_at') || '',
      last_error_class: r.getString('last_error_class') || '',
      created: r.getString('created') || '',
    };
  });

  return c.json(200, { items: items, page: page, perPage: perPage });
}

function logs(c) {
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var page = integerParam(c.queryParam('page'), 1, 1, 1000);
  var perPage = integerParam(c.queryParam('perPage'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  var result = inSet(c.queryParam('result'), LOG_RESULTS);
  var category = stringParam(c.queryParam('category'));

  var filter = 'id != ""';
  var params = {};
  if (result) { filter = 'result = {:result}'; params.result = result; }
  if (category) {
    filter = filter === 'id != ""' ? 'category = {:category}' : filter + ' && category = {:category}';
    params.category = category;
  }

  var offset = (page - 1) * perPage;
  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter('mail_delivery_logs', filter, '-created', perPage, offset, params);
  } catch (_) {}

  var items = rows.map(function (r) {
    return {
      id: r.id,
      event_id: r.getString('event_id'),
      category: r.getString('category'),
      source_kind: r.getString('source_kind'),
      result: r.getString('result'),
      duration_ms: r.getInt('duration_ms'),
      attempt: r.getInt('attempt'),
      error_class: r.getString('error_class') || '',
      archive_batch_id: r.getString('archive_batch_id') || '',
      created: r.getString('created') || '',
    };
  });

  return c.json(200, { items: items, page: page, perPage: perPage });
}

function verify(c) {
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var status = null;
  var error = null;
  try {
    status = gateway.status();
  } catch (e) {
    error = String(e && e.message || 'verification failed');
  }

  return c.json(200, {
    verified: status !== null,
    gateway: status,
    error: error,
    checked_at: new Date().toISOString(),
  });
}

module.exports = {
  overview: overview,
  queue: queue,
  logs: logs,
  verify: verify,
};