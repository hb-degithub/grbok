'use strict';

// 评论编辑/删除邮箱验证码服务
// 使用 PocketBase 的 verificationCodes 集合存储验证码

var rateLimit = require('./security_rate_limit.js');

var CODE_LENGTH = 6;
var CODE_EXPIRY_MINUTES = 10;
var MAX_ATTEMPTS = 5;

function detailedError(status, code, retryAfter) {
  var data = {
    code: new ValidationError(code, code),
  };
  if (retryAfter) {
    data.retryAfter = new ValidationError('VERIFICATION_RETRY_AFTER', String(retryAfter));
  }
  return new ApiError(status, code, data);
}

function getClientIP(e) {
  try {
    return rateLimit.normalizeIp(require('./client_ip.js').clientIp(e));
  } catch (_) {
    return 'unknown';
  }
}

function checkRateLimit(ip, policyKey) {
  var decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: policyKey, subject: ip }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    throw detailedError(503, 'VERIFICATION_UNAVAILABLE');
  }
  if (!decision.allowed) {
    throw detailedError(429, 'VERIFICATION_RATE_LIMITED', decision.retryAfterSeconds);
  }
}

/**
 * 生成并发送验证码
 */
function sendVerificationCode(email, ip) {
  if (!email) throw new BadRequestError('Email is required');

  // 限流：同一邮箱每分钟最多 1 次
  checkRateLimit(email, 'comment_verification_email');
  checkRateLimit(ip, 'comment_verification_ip');

  // 生成 6 位数字验证码
  var code = '';
  for (var i = 0; i < CODE_LENGTH; i++) {
    code += Math.floor(Math.random() * 10);
  }

  // 存储验证码（10 分钟过期）
  var expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

  try {
    // 删除该邮箱的旧验证码
    var oldCodes = $app.dao().findRecordsByFilter('verificationCodes', 'email = {:email}', '', 10, 0, { email: email });
    for (var i = 0; i < oldCodes.length; i++) {
      $app.dao().deleteRecord(oldCodes[i]);
    }

    // 创建新验证码
    var record = new Record($app.dao().findCollectionByNameOrId('verificationCodes'));
    record.set('email', email);
    record.set('code', code);
    record.set('expires_at', expiresAt);
    record.set('attempts', 0);
    $app.dao().saveRecord(record);
  } catch (err) {
    // verificationCodes 集合不存在，创建它
    if (String(err).indexOf('collection') !== -1) {
      createVerificationCollection();
      // 重试
      var record = new Record($app.dao().findCollectionByNameOrId('verificationCodes'));
      record.set('email', email);
      record.set('code', code);
      record.set('expires_at', expiresAt);
      record.set('attempts', 0);
      $app.dao().saveRecord(record);
    } else {
      throw err;
    }
  }

  // 发送验证码邮件
  try {
    $app.dao().runInTransaction(function (txDao) {
      require('./mail_outbox.js').enqueue(txDao, {
        dedupeKey: 'comment_verification:' + email + ':' + Date.now(),
        category: 'comment_verification',
        recipient: email,
        templateKey: 'comment_verification',
        variables: { code: code },
      });
    });
  } catch (err) {
    console.error('[comment-verification] operation=send result=MAIL_ERROR');
    throw detailedError(503, 'VERIFICATION_MAIL_FAILED');
  }

  return { ok: true, expiresAt: expiresAt };
}

/**
 * 验证验证码
 */
function verifyCode(email, code) {
  if (!email || !code) return false;

  try {
    // 按 email 查询最新验证码
    var records = $app.dao().findRecordsByFilter(
      'verificationCodes',
      'email = {:email}',
      '-created',
      1,
      0,
      { email: email }
    );

    if (!records || records.length === 0) return false;

    var record = records[0];
    var expiresAt = new Date(record.getString('expires_at'));
    var now = new Date();

    // 检查是否过期
    if (now > expiresAt) {
      $app.dao().deleteRecord(record);
      return false;
    }

    // 检查尝试次数
    var attempts = record.getInt('attempts') || 0;
    if (attempts >= MAX_ATTEMPTS) {
      $app.dao().deleteRecord(record);
      return false;
    }

    // 验证码不匹配，递增尝试次数
    if (record.getString('code') !== code) {
      record.set('attempts', attempts + 1);
      $app.dao().saveRecord(record);
      return false;
    }

    // 验证成功，删除验证码（一次性使用）
    $app.dao().deleteRecord(record);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 创建 verificationCodes 集合（如果不存在）
 */
function createVerificationCollection() {
  try {
    $app.dao().findCollectionByNameOrId('verificationCodes');
  } catch (_) {
    var collection = new Collection({
      name: 'verificationCodes',
      type: 'base',
      system: false,
      schema: [
        { name: 'email', type: 'text', required: true, options: { min: 1, max: 320, pattern: '' } },
        { name: 'code', type: 'text', required: true, options: { min: 6, max: 6, pattern: '^[0-9]{6}$' } },
        { name: 'expires_at', type: 'date', required: true },
        { name: 'attempts', type: 'number', required: false, options: { min: 0, max: 10 } },
      ],
    });
    // 只有服务端可以访问
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;
    $app.dao().saveCollection(collection);
  }
}

module.exports = {
  sendVerificationCode: sendVerificationCode,
  verifyCode: verifyCode,
};
