'use strict';

var DEFAULTS = {
  account_mail_email: { limit: 2, windowSeconds: 900 },
  account_mail_ip: { limit: 5, windowSeconds: 900 },
  account_mail_global: { limit: 30, windowSeconds: 60 },
  registration_ip: { limit: 3, windowSeconds: 3600 },
  registration_ipv6_64: { limit: 10, windowSeconds: 3600 },
  registration_global: { limit: 20, windowSeconds: 60 },
  guestbook_ip: { limit: 5, windowSeconds: 3600 },
  comment_ip: { limit: 5, windowSeconds: 60 },
  comment_email: { limit: 3, windowSeconds: 60 },
  comment_post: { limit: 12, windowSeconds: 60 },
  comment_report_ip: { limit: 5, windowSeconds: 600 },
  comment_like_ip: { limit: 10, windowSeconds: 60 },
  comment_edit_ip: { limit: 5, windowSeconds: 300 },
  comment_delete_ip: { limit: 3, windowSeconds: 300 },
  comment_verification_email: { limit: 1, windowSeconds: 60 },
  comment_verification_ip: { limit: 5, windowSeconds: 60 },
  admin_test_actor: { limit: 3, windowSeconds: 3600 },
  admin_test_global: { limit: 10, windowSeconds: 86400 },
  admin_security_write: { limit: 5, windowSeconds: 3600 },
  // TOTP step-up 验证：5 次失败 / 5 分钟窗口（按管理员 actorId 计）
  admin_totp_verify: { limit: 5, windowSeconds: 300 },
  // 超限后锁定 15 分钟：锁定桶仅写入一次（limit=1 / 900s 窗口）
  admin_totp_lockout: { limit: 1, windowSeconds: 900 },
  comment_notification: { limit: 60, windowSeconds: 60 },
  comment_reply_notification: { limit: 60, windowSeconds: 60 },
  account_retention_notice: { limit: 10, windowSeconds: 60 },
  outbound_global: { limit: 60, windowSeconds: 60 },
};

var BOUNDS = {
  account_mail_email: { minLimit: 1, maxLimit: 5, minWindow: 300, maxWindow: 3600 },
  account_mail_ip: { minLimit: 2, maxLimit: 20, minWindow: 300, maxWindow: 3600 },
  account_mail_global: { minLimit: 10, maxLimit: 120, minWindow: 60, maxWindow: 900 },
  registration_ip: { minLimit: 1, maxLimit: 10, minWindow: 3600, maxWindow: 3600 },
  registration_ipv6_64: { minLimit: 2, maxLimit: 30, minWindow: 3600, maxWindow: 3600 },
  registration_global: { minLimit: 5, maxLimit: 60, minWindow: 60, maxWindow: 60 },
  guestbook_ip: { minLimit: 1, maxLimit: 10, minWindow: 3600, maxWindow: 3600 },
  comment_ip: { minLimit: 1, maxLimit: 30, minWindow: 60, maxWindow: 3600 },
  comment_email: { minLimit: 1, maxLimit: 20, minWindow: 60, maxWindow: 3600 },
  comment_post: { minLimit: 1, maxLimit: 60, minWindow: 60, maxWindow: 3600 },
  comment_report_ip: { minLimit: 1, maxLimit: 20, minWindow: 300, maxWindow: 3600 },
  comment_like_ip: { minLimit: 5, maxLimit: 30, minWindow: 60, maxWindow: 300 },
  comment_edit_ip: { minLimit: 1, maxLimit: 10, minWindow: 300, maxWindow: 3600 },
  comment_delete_ip: { minLimit: 1, maxLimit: 10, minWindow: 300, maxWindow: 3600 },
  comment_verification_email: { minLimit: 1, maxLimit: 5, minWindow: 60, maxWindow: 300 },
  comment_verification_ip: { minLimit: 1, maxLimit: 20, minWindow: 60, maxWindow: 300 },
  admin_test_actor: { minLimit: 3, maxLimit: 3, minWindow: 3600, maxWindow: 3600 },
  admin_test_global: { minLimit: 10, maxLimit: 10, minWindow: 86400, maxWindow: 86400 },
  admin_security_write: { minLimit: 5, maxLimit: 5, minWindow: 3600, maxWindow: 3600 },
  admin_totp_verify: { minLimit: 5, maxLimit: 5, minWindow: 300, maxWindow: 300 },
  admin_totp_lockout: { minLimit: 1, maxLimit: 1, minWindow: 900, maxWindow: 900 },
  comment_notification: { minLimit: 60, maxLimit: 60, minWindow: 60, maxWindow: 60 },
  comment_reply_notification: { minLimit: 60, maxLimit: 60, minWindow: 60, maxWindow: 60 },
  account_retention_notice: { minLimit: 10, maxLimit: 10, minWindow: 60, maxWindow: 60 },
  outbound_global: { minLimit: 60, maxLimit: 60, minWindow: 60, maxWindow: 60 },
};

function coded(code, message) {
  var error = new Error(message || code);
  error.code = code;
  return error;
}

function cloneDefaults() {
  var result = {};
  Object.keys(DEFAULTS).forEach(function (key) {
    result[key] = { limit: DEFAULTS[key].limit, windowSeconds: DEFAULTS[key].windowSeconds };
  });
  return result;
}

function readInt(record, field) {
  var value = Number(record.get(field));
  return Number.isSafeInteger(value) ? value : 0;
}

function getRatePolicySet(dao) {
  var records;
  try {
    records = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  } catch (_) {
    return { version: 0, policies: cloneDefaults(), degraded: true };
  }
  var policies = {};
  var version = null;
  var valid = records && records.length === Object.keys(DEFAULTS).length;
  for (var i = 0; valid && i < records.length; i++) {
    var key = String(records[i].get('key'));
    var bound = BOUNDS[key];
    var limit = readInt(records[i], 'limit');
    var windowSeconds = readInt(records[i], 'window_seconds');
    var rowVersion = readInt(records[i], 'version');
    if (!bound || policies[key] || rowVersion < 1 ||
        limit < bound.minLimit || limit > bound.maxLimit ||
        windowSeconds < bound.minWindow || windowSeconds > bound.maxWindow ||
        (version !== null && version !== rowVersion)) {
      valid = false;
      break;
    }
    version = rowVersion;
    policies[key] = { limit: limit, windowSeconds: windowSeconds };
  }
  if (!valid) return { version: 0, policies: cloneDefaults(), degraded: true };
  return { version: version || 1, policies: policies, degraded: false };
}

function normalizeInput(input) {
  var source = input;
  if (Array.isArray(source)) {
    source = {};
    for (var i = 0; i < input.length; i++) {
      if (!input[i] || typeof input[i] !== 'object') throw coded('POLICY_OUT_OF_SAFE_RANGE');
      source[String(input[i].key || '')] = input[i];
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw coded('POLICY_OUT_OF_SAFE_RANGE');
  }
  var keys = Object.keys(source);
  var fixedKeys = Object.keys(BOUNDS);
  if (keys.length !== fixedKeys.length) throw coded('POLICY_OUT_OF_SAFE_RANGE');
  var normalized = {};
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    var value = source[key];
    var bound = BOUNDS[key];
    var limit = Number(value && value.limit);
    var windowSeconds = Number(value && (value.windowSeconds !== undefined ? value.windowSeconds : value.window_seconds));
    if (!bound || !Number.isSafeInteger(limit) || !Number.isSafeInteger(windowSeconds) ||
        limit < bound.minLimit || limit > bound.maxLimit ||
        windowSeconds < bound.minWindow || windowSeconds > bound.maxWindow) {
      throw coded('POLICY_OUT_OF_SAFE_RANGE');
    }
    normalized[key] = { limit: limit, windowSeconds: windowSeconds };
  }
  return normalized;
}

function replaceRatePolicySet(txDao, input) {
  if (!input || typeof input !== 'object') throw coded('POLICY_OUT_OF_SAFE_RANGE');
  var current = getRatePolicySet(txDao);
  if (current.degraded || current.version !== Number(input.expectedVersion)) {
    throw coded('POLICY_VERSION_CONFLICT');
  }
  var normalized = normalizeInput(input.policies);
  var nextVersion = current.version + 1;
  var actorId = String(input.actorId || '').trim();
  if (!actorId || actorId.length > 100) throw coded('POLICY_OUT_OF_SAFE_RANGE');
  var now = input.now instanceof Date ? input.now.toISOString() : String(input.now || '');
  if (!now) throw coded('POLICY_OUT_OF_SAFE_RANGE');
  var records = txDao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  for (var i = 0; i < records.length; i++) {
    var key = String(records[i].get('key'));
    records[i].set('limit', normalized[key].limit);
    records[i].set('window_seconds', normalized[key].windowSeconds);
    records[i].set('version', nextVersion);
    records[i].set('updated_by', actorId);
    records[i].set('updated_at', now);
    txDao.saveRecord(records[i]);
  }
  return { version: nextVersion, policies: normalized };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  BOUNDS: BOUNDS,
  getRatePolicySet: getRatePolicySet,
  replaceRatePolicySet: replaceRatePolicySet,
};
