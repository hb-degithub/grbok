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
      var maskedEmail = crypto.maskEmail(String(meta.newEmail || ''));
      variables.newEmailMasked = maskedEmail;
    }

    var templateKey = TEMPLATE_KEY_BY_CATEGORY[category];
    var rendered = templates.render(templateKey, variables);

    var requestId = crypto.requestId('req');
    var messageId = crypto.requestId('msg');

    var recipientHash = crypto.hashPrivate('email', recipient);
    var ipHash = 'local';

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
      request_ip_hash: ipHash,
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
  if (!record) return;
  if (record.verified()) return;
  var email = record.getString('email') || '';
  if (!email) return;
  $mails.sendRecordVerification($app, record);
}

module.exports = {
  forwardAccountMail: forwardAccountMail,
  requestVerificationFor: requestVerificationFor,
  isFeatureEnabled: isFeatureEnabled,
  buildActionUrl: buildActionUrl,
  PATH_BY_CATEGORY: PATH_BY_CATEGORY,
};