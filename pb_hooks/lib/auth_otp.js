'use strict';

var crypto = require('./mail_crypto.js');
var templates = require('./mail_templates.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');

var CHALLENGE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var CODE_ALPHABET = '0123456789';
var EXPIRES_SECONDS = 600;
var LIMITS = {
  email: { max: 3, windowMs: 15 * 60 * 1000 },
  ip: { max: 5, windowMs: 15 * 60 * 1000 },
  global: { max: 30, windowMs: 60 * 1000 },
};

function publicError(name, code) {
  var error = new Error(code);
  error.name = name;
  error.code = code;
  return error;
}

function invalidRequestError() {
  return publicError('InvalidRequestError', 'INVALID_REQUEST');
}

function invalidCodeError() {
  return publicError('InvalidOtpCodeError', 'INVALID_OR_EXPIRED_CODE');
}

function isInvalidRequest(error) {
  return Boolean(error && error.code === 'INVALID_REQUEST');
}

function isInvalidCode(error) {
  return Boolean(error && error.code === 'INVALID_OR_EXPIRED_CODE');
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
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return false;
  }
  return true;
}

function parseObjectBody(e) {
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
  return body;
}

function parseRequest(e) {
  var body = parseObjectBody(e);
  if (typeof body.email !== 'string') throw invalidRequestError();
  var email = normalizeEmail(body.email);
  if (!isValidEmail(email)) throw invalidRequestError();
  return email;
}

function parseVerification(e) {
  var body;
  try {
    body = parseObjectBody(e);
  } catch (_) {
    throw invalidCodeError();
  }
  var challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  var code = typeof body.code === 'string' ? body.code : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(challengeId) || !/^[0-9]{6}$/.test(code)) {
    throw invalidCodeError();
  }
  return { challengeId: challengeId, code: code };
}

function getClientIP(e) {
  try {
    var value = String(e.realIP() || '').trim();
    if (value) return value;
  } catch (_) {}
  return 'unknown';
}

function hashSecret() {
  var secret = String($os.getenv('MAIL_HASH_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('MAIL_HASH_SECRET is not configured');
  return secret;
}

function hashCode(challengeId, code) {
  return $security.hs256(
    'otp-code:' + challengeId + ':' + code,
    hashSecret()
  );
}

function pbDate(timestampMs) {
  return new Date(timestampMs).toISOString().replace('T', ' ');
}

function featureEnabled() {
  return (
    String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true'
    && String($os.getenv('MAIL_OTP_ENABLED') || '').trim().toLowerCase() === 'true'
  );
}

function findUserByEmail(dao, email) {
  var rows = dao.findRecordsByFilter(
    'users',
    'email = {:email}',
    '',
    1,
    0,
    { email: email }
  );
  return rows && rows.length ? rows[0] : null;
}

function eligibleReader(user) {
  return Boolean(
    user
    && user.verified() === true
    && user.getString('role') === 'reader'
  );
}

function countChallenges(dao, field, hash, since, limit) {
  var filter = 'created >= {:since}';
  var params = { since: since };
  if (field === 'email_hash' || field === 'ip_hash') {
    filter = field + ' = {:hash} && ' + filter;
    params.hash = hash;
  } else if (field !== 'global') {
    throw new Error('Unsupported OTP request counter');
  }
  var rows = dao.findRecordsByFilter(
    'auth_otp_challenges',
    filter,
    '-created',
    limit,
    0,
    params
  );
  return rows ? rows.length : 0;
}

function limitedAfterCurrent(dao, emailHash, ipHash) {
  var now = Date.now();
  if (
    countChallenges(
      dao,
      'email_hash',
      emailHash,
      pbDate(now - LIMITS.email.windowMs),
      LIMITS.email.max + 1
    ) > LIMITS.email.max
  ) {
    return true;
  }
  if (
    countChallenges(
      dao,
      'ip_hash',
      ipHash,
      pbDate(now - LIMITS.ip.windowMs),
      LIMITS.ip.max + 1
    ) > LIMITS.ip.max
  ) {
    return true;
  }
  return countChallenges(
    dao,
    'global',
    '',
    pbDate(now - LIMITS.global.windowMs),
    LIMITS.global.max + 1
  ) > LIMITS.global.max;
}

function reserveChallenge(e, email) {
  var challengeId = $security.randomStringWithAlphabet(32, CHALLENGE_ALPHABET);
  var code = $security.randomStringWithAlphabet(6, CODE_ALPHABET);
  var emailHash = crypto.hashPrivate('email', email);
  var ipHash = crypto.hashPrivate('ip', getClientIP(e));
  var reservation = {
    challengeId: challengeId,
    code: code,
    email: email,
    emailHash: emailHash,
    ipHash: ipHash,
    userId: '',
    displayName: '',
    send: false,
  };
  var collection = $app.dao().findCollectionByNameOrId('auth_otp_challenges');
  var record = new Record(collection);
  record.set('challenge_id', challengeId);
  record.set('user', '');
  record.set('email_hash', emailHash);
  record.set('ip_hash', ipHash);
  record.set('code_hash', hashCode(challengeId, code));
  record.set('expires_at', pbDate(Date.now() + EXPIRES_SECONDS * 1000));
  record.set('attempts', 0);
  record.set('consumed_at', '');

  $app.dao().runInTransaction(function (txDao) {
    txDao.saveRecord(record);

    if (limitedAfterCurrent(txDao, emailHash, ipHash) || !featureEnabled()) return;

    var user = findUserByEmail(txDao, email);
    if (!eligibleReader(user)) return;

    record.set('user', user.id);
    txDao.saveRecord(record);
    reservation.userId = user.id;
    reservation.displayName = user.getString('name') || email.split('@')[0];
    reservation.send = true;
  });

  return reservation;
}

function logDelivery(reservation, requestId, result, errorClass) {
  try {
    logs.delivery({
      request_id: requestId,
      category: 'reader_otp',
      source_collection: 'users',
      source_record_id: reservation.userId || 'decoy',
      recipient_masked: crypto.maskEmail(reservation.email),
      recipient_hash: reservation.emailHash,
      request_ip_hash: reservation.ipHash,
      result: result,
      duration_ms: 0,
      attempt: 1,
      error_class: errorClass,
    });
  } catch (_) {}
}

function sendReservedChallenge(reservation) {
  var rendered = templates.render('reader_otp', {
    displayName: reservation.displayName,
    code: reservation.code,
    expiresMinutes: '10',
  });
  var requestId = crypto.requestId('req');
  var messageId = crypto.requestId('msg');
  try {
    gateway.send({
      requestId: requestId,
      messageId: messageId,
      category: rendered.category,
      to: reservation.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    logDelivery(reservation, requestId, 'sent', 'none');
  } catch (error) {
    var code = String(error && error.code ? error.code : 'INTERNAL_ERROR');
    logDelivery(reservation, requestId, 'failed', code);
    console.error('[reader-otp] operation=request result=' + code);
  }
}

function requestOtp(e) {
  var email = parseRequest(e);
  var reservation = reserveChallenge(e, email);
  if (reservation.send) sendReservedChallenge(reservation);
  return {
    challengeId: reservation.challengeId,
    expiresIn: EXPIRES_SECONDS,
  };
}

function verifyOtp(e) {
  var input = parseVerification(e);
  var verifiedUserId = '';

  $app.dao().runInTransaction(function (txDao) {
    var rows = txDao.findRecordsByFilter(
      'auth_otp_challenges',
      'challenge_id = {:challengeId}',
      '',
      1,
      0,
      { challengeId: input.challengeId }
    );
    if (!rows || !rows.length) return;

    var challenge = rows[0];
    var userId = challenge.getString('user');
    var attempts = challenge.getInt('attempts');
    var now = pbDate(Date.now());
    if (
      challenge.getString('consumed_at')
      || !userId
      || attempts >= 5
      || challenge.getString('expires_at') <= now
    ) {
      return;
    }

    challenge.set('attempts', attempts + 1);
    txDao.saveRecord(challenge);

    var expected = hashCode(input.challengeId, input.code);
    var stored = challenge.getString('code_hash');
    if (!$security.equal(expected, stored)) return;

    var user;
    try {
      user = txDao.findRecordById('users', userId);
    } catch (_) {
      return;
    }
    if (!eligibleReader(user)) return;

    var consumedAt = pbDate(Date.now());
    while (true) {
      var userChallenges = txDao.findRecordsByFilter(
        'auth_otp_challenges',
        'user = {:user} && consumed_at = ""',
        'created',
        500,
        0,
        { user: userId }
      );
      for (var i = 0; i < userChallenges.length; i++) {
        userChallenges[i].set('consumed_at', consumedAt);
        txDao.saveRecord(userChallenges[i]);
      }
      if (userChallenges.length < 500) break;
    }
    verifiedUserId = userId;
  });

  if (!verifiedUserId) throw invalidCodeError();
  try {
    return $app.dao().findRecordById('users', verifiedUserId);
  } catch (_) {
    throw invalidCodeError();
  }
}

function cleanupExpired() {
  var cutoff = pbDate(Date.now() - 24 * 60 * 60 * 1000);
  var total = 0;
  while (true) {
    var deleted = 0;
    $app.dao().runInTransaction(function (txDao) {
      var rows = txDao.findRecordsByFilter(
        'auth_otp_challenges',
        'created < {:cutoff}',
        'created',
        500,
        0,
        { cutoff: cutoff }
      );
      for (var i = 0; i < rows.length; i++) {
        txDao.deleteRecord(rows[i]);
      }
      deleted = rows.length;
    });
    total += deleted;
    if (deleted < 500) return total;
  }
}

module.exports = {
  requestOtp: requestOtp,
  verifyOtp: verifyOtp,
  cleanupExpired: cleanupExpired,
  isInvalidRequest: isInvalidRequest,
  isInvalidCode: isInvalidCode,
};
