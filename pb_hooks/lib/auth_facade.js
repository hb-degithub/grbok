'use strict';

var crypto = require('./mail_crypto.js');
var templates = require('./mail_templates.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');
var rateLimit = require('./security_rate_limit.js');

var PATH_BY_CATEGORY = {
  account_verification: '/verify-email?token=',
  account_password_reset: '/reset-password?token=',
  account_email_change: '/confirm-email-change?token=',
};
var TEMPLATE_KEY_BY_CATEGORY = {
  account_verification: 'account_verification',
  account_password_reset: 'account_password_reset',
  account_email_change: 'account_email_change',
};
var REQUEST_CONFIG = {
  passwordReset: { field: 'email', category: 'account_password_reset', path: '/api/collections/users/request-password-reset' },
  verification: { field: 'email', category: 'account_verification', path: '/api/collections/users/request-verification' },
  emailChange: { field: 'newEmail', category: 'account_email_change', path: '/api/collections/users/request-email-change' },
};

function isFeatureEnabled() {
  return String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true'
    && String($os.getenv('MAIL_ACCOUNT_ENABLED') || '').trim().toLowerCase() === 'true';
}

function stableError(error) {
  var code = String(error && error.code ? error.code : 'INTERNAL_ERROR').toLowerCase();
  var allowed = {
    mail_not_configured: true, smtp_auth: true, smtp_connection: true, smtp_timeout: true,
    recipient_temporary: true, recipient_permanent: true, payload_invalid: true,
    rate_limited: true, internal_error: true,
  };
  return allowed[code] ? code : 'internal_error';
}

function buildActionUrl(token, category) {
  var base = String($os.getenv('PUBLIC_SITE_URL') || '').trim().replace(/\/$/, '');
  if (!base || !PATH_BY_CATEGORY[category]) throw new Error('mail action URL unavailable');
  return base + PATH_BY_CATEGORY[category] + String(token);
}

function forwardAccountMail(category, e) {
  var record = e.record;
  var meta = e.meta || {};
  var token = category === 'account_email_change' ? String(meta.newEmailToken || meta.token || '') : String(meta.token || '');
  var recipient = category === 'account_email_change' ? String(meta.newEmail || '') : String(record && record.getString('email') || '');
  if (!recipient || !token || !isFeatureEnabled()) return;
  var eventId = crypto.requestId('evt');
  var startedAt = Date.now();
  var result = 'failed';
  var errorClass = 'internal_error';
  try {
    var displayName = String(record && (record.getString('name') || record.getString('email').split('@')[0]) || '');
    var variables = { displayName: displayName, actionUrl: buildActionUrl(token, category), expiresMinutes: '24\u5c0f\u65f6' };
    if (category === 'account_email_change') variables.newEmailMasked = crypto.maskEmail(recipient);
    var rendered = templates.render(TEMPLATE_KEY_BY_CATEGORY[category], variables);
    gateway.send({
      requestId: eventId,
      messageId: crypto.requestId('msg'),
      category: rendered.category,
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    result = 'sent';
    errorClass = 'none';
  } catch (error) {
    errorClass = stableError(error);
    console.error('[account-mail] category=' + category + ' result=' + errorClass.toUpperCase());
  }
  try {
    logs.delivery({
      event_id: eventId, category: category, source_kind: 'account', result: result,
      duration_ms: Math.min(120000, Math.max(0, Date.now() - startedAt)), attempt: 1, error_class: errorClass,
    });
  } catch (_) {}
}

function requestVerificationFor(record) {
  if (!record || record.verified() || !record.getString('email')) return;
  $mails.sendRecordVerification($app, record);
}

function invalidRequestError() {
  var error = new Error('Invalid request');
  error.name = 'InvalidRequestError';
  error.code = 'INVALID_REQUEST';
  return error;
}

function isInvalidRequest(error) { return Boolean(error && error.code === 'INVALID_REQUEST'); }

function isValidEmail(email) {
  if (!email || email.length > 320 || email !== email.trim()) return false;
  var parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1] || parts[1].length > 253) return false;
  if (parts[0].charAt(0) === '.' || parts[0].charAt(parts[0].length - 1) === '.' || parts[0].indexOf('..') !== -1 || !/^[^\s@]+$/.test(parts[0])) return false;
  var labels = parts[1].split('.');
  if (labels.length < 2) return false;
  for (var i = 0; i < labels.length; i++) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return false;
  return true;
}

function parseEmailBody(e, field) {
  var body;
  try { body = JSON.parse(readerToString(e.request().body, 4097) || '{}'); } catch (_) { throw invalidRequestError(); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body[field] !== 'string') throw invalidRequestError();
  var email = String(body[field]).trim().toLowerCase();
  if (!isValidEmail(email)) throw invalidRequestError();
  return email;
}

function getClientIP(e) {
  try { return rateLimit.normalizeIp(String(e.realIP() || '').trim()); } catch (_) { return ''; }
}
function getAuthorization(e) {
  try { return String(e.request().header.get('Authorization') || '').trim(); } catch (_) { return ''; }
}
function getCurrentRecord(e) {
  try { return e.get('authRecord') || null; } catch (_) { return null; }
}
function findUserByEmail(dao, email) {
  var rows = dao.findRecordsByFilter('users', 'email = {:email}', '', 1, 0, { email: email });
  return rows && rows.length ? rows[0] : null;
}
function eligible(kind, user, authHeader) {
  if (!isFeatureEnabled()) return false;
  if (kind === 'passwordReset') return Boolean(user);
  if (kind === 'verification') return Boolean(user && !user.verified());
  if (kind === 'emailChange') return Boolean(user && authHeader);
  return false;
}
function forwardToLoopback(path, body, authHeader) {
  var base = String($os.getenv('BLOG_AUTH_LOOPBACK_BASE') || 'http://127.0.0.1:8090').replace(/\/$/, '');
  var headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  try {
    var response = $http.send({ url: base + path, method: 'POST', body: JSON.stringify(body), headers: headers, timeout: 5 });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (_) { return false; }
}

function processAccountRequest(e, kind) {
  var config = REQUEST_CONFIG[kind];
  if (!config) throw new Error('Unsupported account request kind');
  var email = parseEmailBody(e, config.field);
  var ip = getClientIP(e);
  if (!ip) return;
  var authHeader = kind === 'emailChange' ? getAuthorization(e) : '';
  var selected = null;
  var allowed = false;
  try {
    $app.dao().runInTransaction(function (txDao) {
      var result = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [
          { policyKey: 'account_mail_email', subject: email },
          { policyKey: 'account_mail_ip', subject: ip },
          { policyKey: 'account_mail_global', subject: 'v1' },
        ],
      });
      if (!result.allowed) return;
      allowed = true;
      selected = kind === 'emailChange' ? getCurrentRecord(e) : findUserByEmail(txDao, email);
    });
  } catch (_) { return; }
  if (!allowed || !eligible(kind, selected, authHeader)) return;
  var body = {}; body[config.field] = email;
  forwardToLoopback(config.path, body, authHeader);
}

function requestPasswordReset(e) { processAccountRequest(e, 'passwordReset'); }
function requestVerification(e) { processAccountRequest(e, 'verification'); }
function requestEmailChange(e) { processAccountRequest(e, 'emailChange'); }

module.exports = {
  forwardAccountMail: forwardAccountMail,
  requestVerificationFor: requestVerificationFor,
  isFeatureEnabled: isFeatureEnabled,
  buildActionUrl: buildActionUrl,
  PATH_BY_CATEGORY: PATH_BY_CATEGORY,
  requestPasswordReset: requestPasswordReset,
  requestVerification: requestVerification,
  requestEmailChange: requestEmailChange,
  isInvalidRequest: isInvalidRequest,
};
