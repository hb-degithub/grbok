'use strict';

var crypto = require('./mail_crypto.js');
var templates = require('./mail_templates.js');
var gateway = require('./mail_gateway.js');
var logs = require('./mail_logs.js');
var rateLimit = require('./security_rate_limit.js');

var CHALLENGE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var CODE_ALPHABET = '0123456789';
var EXPIRES_SECONDS = 600;
// 2026-10-14 渗透测试 #7：OTP 校验的 per-IP 限流策略键。
// 阈值 20 次 / 600s（窗口 = challenge 有效期 EXPIRES_SECONDS，避免"限流窗口比挑战活得久"
// 把正常用户体验拖长）。取值理由：
//   * 单条 challenge 最多 5 次尝试（下方 attempts >= 5 作废，持久化在 DB 列上）；
//   * account_mail_ip 只允许 5 封/15 分钟 → 单 IP 合法路径最多产生 5 条 challenge = 25 次校验；
//     20 次/10 分钟覆盖"2 条 challenge 全部输错"（10 次）的 2 倍余量，同时把自动化爆破
//     从"无限"（报告实测 1500 次无 429）压到 20 次/10 分钟/IP；
//   * 人民币/移动网络存在大量 CGNAT 共享出口 IP，阈值不宜再压低。
var VERIFY_IP_POLICY = 'otp_verify_ip';

function publicError(name, code) { var error = new Error(code); error.name = name; error.code = code; return error; }
function invalidRequestError() { return publicError('InvalidRequestError', 'INVALID_REQUEST'); }
function invalidCodeError() { return publicError('InvalidOtpCodeError', 'INVALID_OR_EXPIRED_CODE'); }
function rateLimitedError(retryAfterSeconds) {
  var error = publicError('OtpRateLimitedError', 'RATE_LIMITED');
  error.retryAfter = Math.max(1, Number(retryAfterSeconds) || 1);
  return error;
}
function isInvalidRequest(error) { return Boolean(error && error.code === 'INVALID_REQUEST'); }
function isInvalidCode(error) { return Boolean(error && error.code === 'INVALID_OR_EXPIRED_CODE'); }
function isRateLimited(error) { return Boolean(error && error.code === 'RATE_LIMITED'); }

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
  if (String($os.getenv('MAIL_OTP_ENABLED') || '').trim().toLowerCase() !== 'true') return false;
  if (String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() === 'true') return true;
  // 网关 env 未开但后台已配置 SMTP 时同样视为启用（与 mail_gateway.requireEnabled 一致）
  try { return !!require('./mail_smtp_config.js').resolve($app.dao()); } catch (_) { return false; }
}
function findUserByEmail(dao, email) {
  var rows = dao.findRecordsByFilter('users', 'email = {:email}', '', 1, 0, { email: email });
  return rows && rows.length ? rows[0] : null;
}
// 所有已验证邮箱的账号均可接收 OTP；admin/super_admin 登录后仍须通过 TOTP 二次验证（AdminGuard 强制）
function eligibleReader(user) { return Boolean(user && user.verified() === true); }
function getIp(e) { try { return rateLimit.normalizeIp(require('./client_ip.js').clientIp(e)); } catch (_) { return ''; } }
// 限流桶 subject：与 ip_hash 分开，IPv6 按 /64 聚合（单主机可自由轮换 2^64 个地址）。
function getIpSubject(e) {
  var ip = getIp(e);
  if (!ip) return '';
  if (ip.indexOf(':') !== -1) {
    try { return rateLimit.ipv6Prefix64(ip); } catch (_) { return ip; }
  }
  return ip;
}

// 2026-10-14 #7：/api/blog-auth/otp/verify 的 per-IP 持久化限流。
// 计费点在解析 body 之前 —— 畸形请求（攻击者可用任意 challengeId 泛洪）同样计数；
// 挑战级 attempts 上限仍由 auth_otp_challenges.attempts（持久列）承担，语义不变。
// 策略表不可用时降级放行并打日志（可用性优先：真正的爆破上限是 challenge 的 5 次）。
function enforceVerifyIpLimit(e) {
  var ip = getIpSubject(e);
  if (!ip) return;
  var result = null;
  try {
    $app.dao().runInTransaction(function (txDao) {
      result = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: VERIFY_IP_POLICY, subject: ip }],
      });
    });
  } catch (error) {
    console.error('[reader-otp] operation=verify-ip-rate result=UNAVAILABLE name=' + String((error && error.name) || 'Error'));
    return;
  }
  if (result && !result.allowed) throw rateLimitedError(result.retryAfterSeconds);
}

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
  enforceVerifyIpLimit(e);
  var input = parseVerification(e);
  var verifiedUserId = '';
  $app.dao().runInTransaction(function (txDao) {
    var rows = txDao.findRecordsByFilter('auth_otp_challenges', 'challenge_id = {:challengeId}', '', 1, 0, { challengeId: input.challengeId });
    if (!rows || !rows.length) return;
    var challenge = rows[0];
    var userId = challenge.getString('user');
    var attempts = challenge.getInt('attempts');
    var now = pbDate(Date.now());
    if (challenge.getString('consumed_at') || !userId || attempts >= 5 || challenge.getString('expires_at') <= now) {
      // 2026-10-14 #7：把「attempts 打满即整条作废」落成持久状态（兼容历史 attempts>=5 的行），
      // 语义与原来完全一致，但后续任何请求都会在 consumed_at 上短路。
      if (!challenge.getString('consumed_at') && attempts >= 5) {
        challenge.set('consumed_at', now);
        txDao.saveRecord(challenge);
      }
      return;
    }
    challenge.set('attempts', attempts + 1);
    if (attempts + 1 >= 5) challenge.set('consumed_at', now);
    txDao.saveRecord(challenge);
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

module.exports = { requestOtp: requestOtp, verifyOtp: verifyOtp, cleanupExpired: cleanupExpired, isInvalidRequest: isInvalidRequest, isInvalidCode: isInvalidCode, isRateLimited: isRateLimited };
