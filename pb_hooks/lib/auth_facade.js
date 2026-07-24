'use strict';

var crypto = require('./mail_crypto.js');
var templates = require('./mail_templates.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');

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

function isFeatureEnabled() {
  var gw = String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true';
  var acct = String($os.getenv('MAIL_ACCOUNT_ENABLED') || '').trim().toLowerCase() === 'true';
  return gw && acct;
}

function buildActionUrl(token, category) {
  var base = String($os.getenv('PUBLIC_SITE_URL') || '').trim();
  if (!base) throw new Error('PUBLIC_SITE_URL is not configured');
  var path = PATH_BY_CATEGORY[category];
  if (!path) throw new Error('unknown category: ' + category);
  return base + path + token;
}

function getDisplayName(record) {
  if (!record) return '';
  var name = record.getString('name') || '';
  if (name) return name;
  var email = record.getString('email') || '';
  if (email) return email.split('@')[0];
  return '';
}

function getRecipient(record, meta) {
  if (meta && meta.newEmail) return String(meta.newEmail);
  if (record) return record.getString('email') || '';
  return '';
}

function forwardAccountMail(category, e) {
  var record = e.record;
  var meta = e.meta || {};
  var token = '';

  if (category === 'account_email_change') {
    token = String(meta.newEmailToken || meta.token || '');
  } else {
    token = String(meta.token || '');
  }

  var recipient = getRecipient(record, meta);
  if (!recipient || !token) {
    console.error('[account-mail] category=' + category + ' result=MISSING_DATA');
    return;
  }

  if (!isFeatureEnabled()) {
    console.error('[account-mail] category=' + category + ' result=ACCOUNT_DISABLED');
    return;
  }

  try {
    var actionUrl = buildActionUrl(token, category);
    var displayName = getDisplayName(record);
    var expiresMinutes = '24\u5c0f\u65f6';
    var variables = {
      displayName: displayName,
      actionUrl: actionUrl,
      expiresMinutes: expiresMinutes,
    };

    if (category === 'account_email_change') {
      variables.newEmailMasked = crypto.maskEmail(String(meta.newEmail || ''));
    }

    var rendered = templates.render(TEMPLATE_KEY_BY_CATEGORY[category], variables);
    var requestId = crypto.requestId('req');
    var messageId = crypto.requestId('msg');
    var recipientHash = crypto.hashPrivate('email', recipient);

    gateway.send({
      requestId: requestId,
      messageId: messageId,
      category: rendered.category,
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    logs.delivery({
      request_id: requestId,
      category: rendered.category,
      source_collection: 'users',
      source_record_id: record ? record.id : 'unknown',
      recipient_masked: crypto.maskEmail(recipient),
      recipient_hash: recipientHash,
      request_ip_hash: 'local',
      result: 'sent',
      duration_ms: 0,
      attempt: 1,
      error_class: 'none',
    });
  } catch (err) {
    var stableCode = 'INTERNAL_ERROR';
    var errMsg = String(err && err.message ? err.message : err);
    if (errMsg.indexOf('MAIL_NOT_CONFIGURED') !== -1) stableCode = 'MAIL_NOT_CONFIGURED';
    else if (errMsg.indexOf('SMTP') !== -1) stableCode = 'SMTP_CONNECTION';
    else if (errMsg.indexOf('RATE_LIMITED') !== -1) stableCode = 'RATE_LIMITED';
    console.error('[account-mail] category=' + category + ' result=' + stableCode);
  }
}

function requestVerificationFor(record) {
  if (!record || record.verified()) return;
  if (!record.getString('email')) return;
  $mails.sendRecordVerification($app, record);
}

var ACCEPTED_MESSAGE = '\u5982\u679c\u8be5\u8d26\u6237\u53ef\u7528\uff0c\u6211\u4eec\u4f1a\u53d1\u9001\u90ae\u4ef6\u3002';
var LOOPBACK_BASE = 'http://127.0.0.1:8090';
var LOOPBACK_TIMEOUT_SECONDS = 5;
var ACCOUNT_REQUEST_SOURCE = 'account_request';

var BUILT_IN_PATHS = {
  passwordReset: '/api/collections/users/request-password-reset',
  verification: '/api/collections/users/request-verification',
  emailChange: '/api/collections/users/request-email-change',
};

var ACCOUNT_LIMITS = {
  email: { max: 3, windowMs: 15 * 60 * 1000 },
  ip: { max: 5, windowMs: 15 * 60 * 1000 },
  global: { max: 30, windowMs: 60 * 1000 },
};

var REQUEST_CONFIG = {
  passwordReset: {
    field: 'email',
    category: 'account_password_reset',
    path: BUILT_IN_PATHS.passwordReset,
  },
  verification: {
    field: 'email',
    category: 'account_verification',
    path: BUILT_IN_PATHS.verification,
  },
  emailChange: {
    field: 'newEmail',
    category: 'account_email_change',
    path: BUILT_IN_PATHS.emailChange,
  },
};

function invalidRequestError() {
  var error = new Error('Invalid request');
  error.name = 'InvalidRequestError';
  error.code = 'INVALID_REQUEST';
  return error;
}

function isInvalidRequest(error) {
  return Boolean(error && error.code === 'INVALID_REQUEST');
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 320 || email !== email.trim()) return false;
  var parts = email.split('@');
  if (parts.length !== 2) return false;

  var local = parts[0];
  var domain = parts[1];
  if (
    !local
    || local.length > 64
    || local.charAt(0) === '.'
    || local.charAt(local.length - 1) === '.'
    || local.indexOf('..') !== -1
    || !/^[^\s@]+$/.test(local)
  ) {
    return false;
  }

  if (!domain || domain.length > 253 || domain.indexOf('..') !== -1) return false;
  var labels = domain.split('.');
  if (labels.length < 2) return false;
  for (var i = 0; i < labels.length; i++) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) {
      return false;
    }
  }
  return true;
}

function parseEmailBody(e, field) {
  var raw = '';
  try {
    raw = readerToString(e.request().body, 4097);
  } catch (_) {
    throw invalidRequestError();
  }

  var body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (_) {
    throw invalidRequestError();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequestError();
  }
  if (typeof body[field] !== 'string') throw invalidRequestError();

  var email = normalizeEmail(body[field]);
  if (!isValidEmail(email)) throw invalidRequestError();
  return email;
}

function getClientIP(e) {
  try {
    var value = String(e.realIP() || '').trim();
    if (value) return value;
  } catch (_) {}
  return 'unknown';
}

function getAuthorization(e) {
  try {
    return String(e.request().header.get('Authorization') || '').trim();
  } catch (_) {
    return '';
  }
}

function getCurrentRecord(e) {
  try {
    return e.get('authRecord') || null;
  } catch (_) {
    return null;
  }
}

function acceptedResponse() {
  return { accepted: true, message: ACCEPTED_MESSAGE };
}

function waitForMinimum(startedAt, minimumMs) {
  var remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) sleep(remaining);
}

function accountRequestScope() {
  return [
    'source_collection = {:source}',
    '(category = {:reset} || category = {:verification} || category = {:change})',
    'created >= {:since}',
  ].join(' && ');
}

function countAccountRequests(dao, field, hash, sinceIso, limit) {
  var filter = accountRequestScope();
  var params = {
    source: ACCOUNT_REQUEST_SOURCE,
    reset: 'account_password_reset',
    verification: 'account_verification',
    change: 'account_email_change',
    since: sinceIso,
  };

  if (field === 'recipient_hash') {
    filter = 'recipient_hash = {:hash} && ' + filter;
    params.hash = hash;
  } else if (field === 'request_ip_hash') {
    filter = 'request_ip_hash = {:hash} && ' + filter;
    params.hash = hash;
  } else if (field !== 'global') {
    throw new Error('Unsupported account request counter');
  }

  var records = dao.findRecordsByFilter(
    'mail_delivery_logs',
    filter,
    '-created',
    limit,
    0,
    params,
  );
  return records ? records.length : 0;
}

function checkAccountLimitsAfterReservation(dao, emailHash, ipHash) {
  var now = Date.now();
  var emailSince = new Date(now - ACCOUNT_LIMITS.email.windowMs).toISOString().replace('T', ' ');
  var ipSince = new Date(now - ACCOUNT_LIMITS.ip.windowMs).toISOString().replace('T', ' ');
  var globalSince = new Date(now - ACCOUNT_LIMITS.global.windowMs).toISOString().replace('T', ' ');

  if (
    countAccountRequests(
      dao,
      'recipient_hash',
      emailHash,
      emailSince,
      ACCOUNT_LIMITS.email.max + 1,
    ) > ACCOUNT_LIMITS.email.max
  ) {
    return 'rate_limited';
  }
  if (
    countAccountRequests(
      dao,
      'request_ip_hash',
      ipHash,
      ipSince,
      ACCOUNT_LIMITS.ip.max + 1,
    ) > ACCOUNT_LIMITS.ip.max
  ) {
    return 'rate_limited';
  }
  if (
    countAccountRequests(
      dao,
      'global',
      '',
      globalSince,
      ACCOUNT_LIMITS.global.max + 1,
    ) > ACCOUNT_LIMITS.global.max
  ) {
    return 'rate_limited';
  }
  return 'accepted';
}

function createAccountRequestRecord(dao, input) {
  var collection = dao.findCollectionByNameOrId('mail_delivery_logs');
  var record = new Record(collection);
  record.set('request_id', input.requestId);
  record.set('category', input.category);
  record.set('source_collection', ACCOUNT_REQUEST_SOURCE);
  record.set('source_record_id', 'decoy');
  record.set('recipient_masked', crypto.maskEmail(input.email));
  record.set('recipient_hash', input.emailHash);
  record.set('request_ip_hash', input.ipHash);
  record.set('result', 'accepted');
  record.set('duration_ms', 0);
  record.set('attempt', 1);
  record.set('error_class', 'none');
  dao.saveRecord(record);
  return record;
}

function setAccountRequestOutcome(dao, record, result, sourceRecordId, errorClass) {
  record.set('source_record_id', sourceRecordId || 'decoy');
  record.set('result', result);
  record.set('error_class', errorClass || 'none');
  dao.saveRecord(record);
}

function markAccountRequestFailed(requestId) {
  var record = $app.dao().findFirstRecordByData(
    'mail_delivery_logs',
    'request_id',
    requestId,
  );
  if (!record) return;
  record.set('result', 'failed');
  record.set('error_class', 'loopback_failed');
  $app.dao().saveRecord(record);
}

function forwardToLoopback(path, body, authHeader) {
  var headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  try {
    var response = $http.send({
      url: LOOPBACK_BASE + path,
      method: 'POST',
      body: JSON.stringify(body),
      headers: headers,
      timeout: LOOPBACK_TIMEOUT_SECONDS,
    });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (_) {
    return false;
  }
}

function findUserByEmail(dao, email) {
  var records = dao.findRecordsByFilter(
    'users',
    'email = {:email}',
    '',
    1,
    0,
    { email: email },
  );
  return records && records.length > 0 ? records[0] : null;
}

function eligibleForRequest(kind, user, authHeader) {
  if (!isFeatureEnabled()) return false;
  if (kind === 'passwordReset') return Boolean(user);
  if (kind === 'verification') return Boolean(user && !user.verified());
  if (kind === 'emailChange') return Boolean(user && authHeader);
  return false;
}

function reserveAccountRequest(e, kind, config, email, emailHash, ipHash, authHeader) {
  var reservation = null;

  $app.dao().runInTransaction(function (txDao) {
    var requestId = crypto.requestId('req');
    var record = createAccountRequestRecord(txDao, {
      requestId: requestId,
      category: config.category,
      email: email,
      emailHash: emailHash,
      ipHash: ipHash,
    });

    var limitStatus = checkAccountLimitsAfterReservation(txDao, emailHash, ipHash);
    if (limitStatus === 'rate_limited') {
      setAccountRequestOutcome(
        txDao,
        record,
        'rate_limited',
        'decoy',
        'rate_limited',
      );
      reservation = {
        requestId: requestId,
        result: 'rate_limited',
        user: null,
      };
      return;
    }

    var user = kind === 'emailChange'
      ? getCurrentRecord(e)
      : findUserByEmail(txDao, email);
    var result = eligibleForRequest(kind, user, authHeader) ? 'accepted' : 'decoy';
    setAccountRequestOutcome(
      txDao,
      record,
      result,
      user ? user.id : 'decoy',
      'none',
    );
    reservation = {
      requestId: requestId,
      result: result,
      user: user,
    };
  });

  if (!reservation) throw new Error('Account request reservation failed');
  return reservation;
}

function processAccountRequest(e, kind) {
  var config = REQUEST_CONFIG[kind];
  if (!config) throw new Error('Unsupported account request kind');

  var email = parseEmailBody(e, config.field);
  var emailHash = crypto.hashPrivate('email', email);
  var ipHash = crypto.hashPrivate('ip', getClientIP(e));
  var authHeader = kind === 'emailChange' ? getAuthorization(e) : '';
  var reservation = reserveAccountRequest(
    e,
    kind,
    config,
    email,
    emailHash,
    ipHash,
    authHeader,
  );
  if (reservation.result !== 'accepted') return;

  var body = {};
  body[config.field] = email;
  if (!forwardToLoopback(config.path, body, authHeader)) {
    markAccountRequestFailed(reservation.requestId);
  }
}

function requestPasswordReset(e) {
  processAccountRequest(e, 'passwordReset');
}

function requestVerification(e) {
  processAccountRequest(e, 'verification');
}

function requestEmailChange(e) {
  processAccountRequest(e, 'emailChange');
}

module.exports = {
  forwardAccountMail: forwardAccountMail,
  requestVerificationFor: requestVerificationFor,
  isFeatureEnabled: isFeatureEnabled,
  buildActionUrl: buildActionUrl,
  PATH_BY_CATEGORY: PATH_BY_CATEGORY,
  acceptedResponse: acceptedResponse,
  waitForMinimum: waitForMinimum,
  requestPasswordReset: requestPasswordReset,
  requestVerification: requestVerification,
  requestEmailChange: requestEmailChange,
  isInvalidRequest: isInvalidRequest,
};
