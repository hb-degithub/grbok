'use strict';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const EMAIL_LOCAL_PATTERN = /^[^\s@]+$/;
const EMAIL_DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function configuredSecret(name) {
  const secret = String($os.getenv(name) || '').trim();
  if (secret.length < 32) {
    throw new Error(name + ' is not configured');
  }
  return secret;
}

function requestId(prefix) {
  return String(prefix) + '_' + $security.randomStringWithAlphabet(26, ID_ALPHABET);
}

function hashPrivate(scope, value) {
  const secret = configuredSecret('MAIL_HASH_SECRET');
  return $security.hs256(
    String(scope) + ':' + String(value).trim().toLowerCase(),
    secret,
  );
}

function maskEmail(address) {
  if (typeof address !== 'string' || address !== address.trim()) return 'invalid';

  const parts = address.split('@');
  if (parts.length !== 2) return 'invalid';

  const local = parts[0];
  const domain = parts[1];
  if (
    !local
    || !domain
    || !EMAIL_LOCAL_PATTERN.test(local)
    || local.charAt(0) === '.'
    || local.charAt(local.length - 1) === '.'
    || local.indexOf('..') !== -1
    || !EMAIL_DOMAIN_PATTERN.test(domain)
  ) {
    return 'invalid';
  }

  if (local.length === 1) return local.charAt(0) + '****@' + domain;
  return local.charAt(0) + '****' + local.charAt(local.length - 1) + '@' + domain;
}

function sign(method, path, rawBody, timestamp, nonce) {
  const secret = configuredSecret('MAIL_INTERNAL_SECRET');
  const canonical = [
    timestamp,
    nonce,
    String(method).toUpperCase(),
    path,
    $security.sha256(rawBody),
  ].join('\n');
  return $security.hs256(canonical, secret);
}

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    throw new TypeError('equal inputs must be strings');
  }
  return $security.equal(left, right);
}

module.exports = {
  requestId,
  hashPrivate,
  maskEmail,
  sign,
  equal,
};