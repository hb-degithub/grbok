'use strict';

var rateLimit = require('./security_rate_limit.js');
var registrationMode = require('./registration_mode.js');
var publicErrors = require('./public_errors.js');

function coded(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function validEmail(value) {
  if (!value || value.length > 320 || value !== value.trim()) return false;
  var parts = value.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1] || parts[1].length > 253) return false;
  if (!/^[^\s@]+$/.test(parts[0])) return false;
  var labels = parts[1].split('.');
  if (labels.length < 2) return false;
  for (var i = 0; i < labels.length; i++) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return false;
  return true;
}

function parse(c) {
  var body;
  try { body = JSON.parse(readerToString(c.request().body, 8193) || '{}'); } catch (_) { throw coded('INVALID_REGISTRATION'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw coded('INVALID_REGISTRATION');
  var email = String(body.email || '').trim().toLowerCase();
  var name = String(body.name || '').trim();
  var password = String(body.password || '');
  var passwordConfirm = String(body.passwordConfirm || '');
  var inviteCode = String(body.inviteCode || '');
  if (!validEmail(email) || !name || name.length > 80 || password.length < 8 || password.length > 72 || password !== passwordConfirm) {
    throw coded('INVALID_REGISTRATION');
  }
  return { email: email, name: name, password: password, passwordConfirm: passwordConfirm, inviteCode: inviteCode };
}

function consumeRegistrationLimits(txDao, ipValue, nowMs) {
  var ip = rateLimit.normalizeIp(String(ipValue || ''));
  var entries = [
    { policyKey: 'registration_ip', subject: ip },
    { policyKey: 'registration_global', subject: 'v1' },
  ];
  if (ip.indexOf(':') !== -1) entries.splice(1, 0, { policyKey: 'registration_ipv6_64', subject: rateLimit.ipv6Prefix64(ip) });
  var result = rateLimit.consume(txDao, { nowMs: nowMs, entries: entries });
  if (!result.allowed) return { allowed: false, code: 'REGISTRATION_RATE_LIMITED', retryAfter: result.retryAfterSeconds };
  return { allowed: true, code: null, retryAfter: 0, ip: ip };
}

function enforceMode(txDao, inviteCode) {
  var current = registrationMode.getRegistrationMode(txDao);
  if (current.mode === 'open') return;
  var expected = String($os.getenv('REGISTRATION_INVITE_CODE') || '');
  if (!expected || !inviteCode || !$security.equal(expected, inviteCode)) throw coded('INVALID_REGISTRATION');
}

function existingReader(txDao, email) {
  var rows = txDao.findRecordsByFilter('users', 'email = {:email}', '', 1, 0, { email: email });
  return rows && rows.length ? rows[0] : null;
}

function createReader(txDao, input) {
  var record = new Record(txDao.findCollectionByNameOrId('users'));
  record.set('email', input.email);
  record.set('username', 'reader_' + $security.randomStringWithAlphabet(16, 'abcdefghijklmnopqrstuvwxyz0123456789'));
  record.set('password', input.password);
  record.set('passwordConfirm', input.passwordConfirm);
  record.set('name', input.name);
  record.set('role', 'reader');
  record.set('verified', false);
  record.refreshTokenKey();
  txDao.saveRecord(record);
  return record;
}

function requestInitialVerification(record, email, ip, nowMs) {
  if (!record) return;
  var allowed = false;
  try {
    $app.dao().runInTransaction(function (txDao) {
      allowed = rateLimit.consume(txDao, {
        nowMs: nowMs,
        entries: [
          { policyKey: 'account_mail_email', subject: email },
          { policyKey: 'account_mail_ip', subject: ip },
          { policyKey: 'account_mail_global', subject: 'v1' },
        ],
      }).allowed;
    });
  } catch (_) { return; }
  if (allowed) {
    try { $mails.sendRecordVerification($app, record); } catch (_) {}
  }
}

function response(c, status, code, referenceId, extra) {
  var body = { code: code, referenceId: referenceId };
  if (status === 202) body.accepted = true;
  if (extra && extra.retryAfter) body.retryAfter = extra.retryAfter;
  return c.json(status, body);
}

function handle(c, deps) {
  var referenceId = publicErrors.referenceId();
  var input;
  try { input = parse(c); } catch (_) { return response(c, 400, 'INVALID_REGISTRATION', referenceId); }
  var nowMs = Date.now();
  var ipValue = deps && deps.ip ? deps.ip : require('./client_ip.js').clientIp(c);
  var outcome = null;
  try {
    $app.dao().runInTransaction(function (txDao) {
      var limit = consumeRegistrationLimits(txDao, ipValue, nowMs);
      if (!limit.allowed) { outcome = { limited: limit }; return; }
      enforceMode(txDao, input.inviteCode);
      if (existingReader(txDao, input.email)) { outcome = { duplicate: true, ip: limit.ip }; return; }
      var retention = deps && deps.accountRetention ? deps.accountRetention : require('./account_retention.js');
      var user = createReader(txDao, input);
      retention.initializeNewUser(txDao, user, nowMs);
      outcome = { user: user, ip: limit.ip };
    });
  } catch (error) {
    if (error && error.code === 'INVALID_REGISTRATION') return response(c, 400, 'INVALID_REGISTRATION', referenceId);
    var message = String(error && error.message || '').toLowerCase();
    if (message.indexOf('unique') !== -1 || message.indexOf('already exists') !== -1) return response(c, 202, 'REGISTRATION_SUBMITTED', referenceId);
    return response(c, 503, 'REGISTRATION_UNAVAILABLE', referenceId);
  }
  if (outcome && outcome.limited) return response(c, 429, 'REGISTRATION_RATE_LIMITED', referenceId, outcome.limited);
  if (outcome && outcome.user) requestInitialVerification(outcome.user, input.email, outcome.ip, nowMs);
  return response(c, 202, 'REGISTRATION_SUBMITTED', referenceId);
}

module.exports = { handle: handle, _consumeRegistrationLimits: consumeRegistrationLimits, _parse: parse };
