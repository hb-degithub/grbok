'use strict';

var crypto = require('./mail_crypto.js');
var templates = require('./mail_templates.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');
var rateLimit = require('./security_rate_limit.js');

var CHALLENGE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var CODE_ALPHABET = '0123456789';
var EXPIRES_SECONDS = 600;

function publicError(name, code) { var error = new Error(code); error.name = name; error.code = code; return error; }
function invalidRequestError() { return publicError('InvalidRequestError', 'INVALID_REQUEST'); }
function invalidCodeError() { return publicError('InvalidOtpCodeError', 'INVALID_OR_EXPIRED_CODE'); }
function isInvalidRequest(error) { return Boolean(error && error.code === 'INVALID_REQUEST'); }
function isInvalidCode(error) { return Boolean(error && error.code === 'INVALID_OR_EXPIRED_CODE'); }

function isValidEmail(email) {
  if (!email || email.length > 320) return false;
  var parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1] || parts[1].split('.').length < 2) return false;
  if (!/^[^\s@]+$/.test(parts[0]) || parts[0].indexOf('..') !== -1 || parts[0].charAt(0) === '.' || parts[0].charAt(parts[0].length - 1) === '.') return false;
  var labels = parts[1].split('.');
  for (var i = 0; i < labels.length; i++) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return false;
  return true;
}
function parseObjectBody(e) {
  var body;
  try { body = JSON.parse(readerToString(e.request().body, 4097) || '{}'); } catch (_) { throw invalidRequestError(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidRequestError();
  return body;
}
function parseRequest(e) {
  var body = parseObjectBody(e);
  var email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) throw invalidRequestError();
  return email;
}
function parseVerification(e) {
  var body;
  try { body = parseObjectBody(e); } catch (_) { throw invalidCodeError(); }
  var challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  var code = typeof body.code === 'string' ? body.code : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(challengeId) || !/^[0-9]{6}$/.test(code)) throw invalidCodeError();
  return { challengeId: challengeId, code: code };
}
function hashSecret() {
  var secret = String($os.getenv('MAIL_HASH_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('MAIL_HASH_SECRET is not configured');
  return secret;
}
function hashCode(challengeId, code) { return $security.hs256('otp-code:' + challengeId + ':' + code, hashSecret()); }
function pbDate(ms) { return new Date(ms).toISOString().replace('T', ' '); }
function featureEnabled() {
  return String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true'
    && String($os.getenv('MAIL_OTP_ENABLED') || '').trim().toLowerCase() === 'true';
}
function findUserByEmail(dao, email) {
  var rows = dao.findRecordsByFilter('users', 'email = {:email}', '', 1, 0, { email: email });
  return rows && rows.length ? rows[0] : null;
}
function eligibleReader(user) { return Boolean(user && user.verified() === true && user.getString('role') === 'reader'); }
function getIp(e) { try { return rateLimit.normalizeIp(String(e.realIP() || '').trim()); } catch (_) { return ''; } }

function reserveChallenge(e, email) {
  var reservation = {
    challengeId: $security.randomStringWithAlphabet(32, CHALLENGE_ALPHABET),
    code: '', email: email, userId: '', displayName: '', send: false,
  };
  var ip = getIp(e);
  if (!ip) return reservation;
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
      if (!result.allowed || !featureEnabled()) return;
      var user = findUserByEmail(txDao, email);
      if (!eligibleReader(user)) return;
      var code = $security.randomStringWithAlphabet(6, CODE_ALPHABET);
      var collection = txDao.findCollectionByNameOrId('auth_otp_challenges');
      var record = new Record(collection);
      record.set('challenge_id', reservation.challengeId);
      record.set('user', user.id);
      record.set('email_hash', crypto.hashPrivate('email', email));
      record.set('ip_hash', crypto.hashPrivate('ip', ip));
      record.set('code_hash', hashCode(reservation.challengeId, code));
      record.set('expires_at', pbDate(Date.now() + EXPIRES_SECONDS * 1000));
      record.set('attempts', 0);
      record.set('consumed_at', '');
      txDao.saveRecord(record);
      reservation.code = code;
      reservation.userId = user.id;
      reservation.displayName = user.getString('name') || email.split('@')[0];
      reservation.send = true;
    });
  } catch (_) { return reservation; }
  return reservation;
}

function sendReservedChallenge(reservation) {
  var rendered = templates.render('reader_otp', { displayName: reservation.displayName, code: reservation.code, expiresMinutes: '10' });
  var eventId = crypto.requestId('evt');
  var startedAt = Date.now();
  var result = 'failed';
  var errorClass = 'internal_error';
  try {
    gateway.send({ requestId: eventId, messageId: crypto.requestId('msg'), category: rendered.category, to: reservation.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
    result = 'sent'; errorClass = 'none';
  } catch (error) {
    errorClass = String(error && error.code ? error.code : 'INTERNAL_ERROR').toLowerCase();
    if (!/^(mail_not_configured|smtp_auth|smtp_connection|smtp_timeout|recipient_temporary|recipient_permanent|payload_invalid|rate_limited|internal_error)$/.test(errorClass)) errorClass = 'internal_error';
    console.error('[reader-otp] operation=request result=' + errorClass.toUpperCase());
  }
  try {
    logs.delivery({ event_id: eventId, category: 'reader_otp', source_kind: 'reader', result: result, duration_ms: Math.min(120000, Date.now() - startedAt), attempt: 1, error_class: errorClass });
  } catch (_) {}
}
function requestOtp(e) {
  var reservation = reserveChallenge(e, parseRequest(e));
  if (reservation.send) sendReservedChallenge(reservation);
  return { challengeId: reservation.challengeId, expiresIn: EXPIRES_SECONDS };
}

function verifyOtp(e) {
  var input = parseVerification(e);
  var verifiedUserId = '';
  $app.dao().runInTransaction(function (txDao) {
    var rows = txDao.findRecordsByFilter('auth_otp_challenges', 'challenge_id = {:challengeId}', '', 1, 0, { challengeId: input.challengeId });
    if (!rows || !rows.length) return;
    var challenge = rows[0];
    var userId = challenge.getString('user');
    var attempts = challenge.getInt('attempts');
    var now = pbDate(Date.now());
    if (challenge.getString('consumed_at') || !userId || attempts >= 5 || challenge.getString('expires_at') <= now) return;
    challenge.set('attempts', attempts + 1); txDao.saveRecord(challenge);
    if (!$security.equal(hashCode(input.challengeId, input.code), challenge.getString('code_hash'))) return;
    var user;
    try { user = txDao.findRecordById('users', userId); } catch (_) { return; }
    if (!eligibleReader(user)) return;
    var consumedAt = pbDate(Date.now());
    var active = txDao.findRecordsByFilter('auth_otp_challenges', 'user = {:user} && consumed_at = ""', 'created', 500, 0, { user: userId });
    for (var i = 0; i < active.length; i++) { active[i].set('consumed_at', consumedAt); txDao.saveRecord(active[i]); }
    verifiedUserId = userId;
  });
  if (!verifiedUserId) throw invalidCodeError();
  try { return $app.dao().findRecordById('users', verifiedUserId); } catch (_) { throw invalidCodeError(); }
}
function cleanupExpired() {
  var cutoff = pbDate(Date.now() - 24 * 60 * 60 * 1000);
  var total = 0;
  while (true) {
    var deleted = 0;
    $app.dao().runInTransaction(function (txDao) {
      var rows = txDao.findRecordsByFilter('auth_otp_challenges', 'created < {:cutoff}', 'created', 500, 0, { cutoff: cutoff });
      for (var i = 0; i < rows.length; i++) txDao.deleteRecord(rows[i]);
      deleted = rows.length;
    });
    total += deleted;
    if (deleted < 500) return total;
  }
}

module.exports = { requestOtp: requestOtp, verifyOtp: verifyOtp, cleanupExpired: cleanupExpired, isInvalidRequest: isInvalidRequest, isInvalidCode: isInvalidCode };
