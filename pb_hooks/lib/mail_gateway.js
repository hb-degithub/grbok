'use strict';

const crypto = require('./mail_crypto.js');

const SEND_PATH = '/internal/mail/send';
const STATUS_PATH = '/internal/mail/status';
const STABLE_CODES = {
  MAIL_NOT_CONFIGURED: true,
  SMTP_AUTH: true,
  SMTP_CONNECTION: true,
  SMTP_TIMEOUT: true,
  RECIPIENT_TEMPORARY: true,
  RECIPIENT_PERMANENT: true,
  PAYLOAD_INVALID: true,
  RATE_LIMITED: true,
  INTERNAL_ERROR: true,
};

function statusFor(code) {
  if (code === 'PAYLOAD_INVALID') return 400;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'RECIPIENT_PERMANENT') return 422;
  if (code === 'INTERNAL_ERROR') return 500;
  return 503;
}

function gatewayError(code, retryable) {
  const stableCode = STABLE_CODES[code] ? code : 'INTERNAL_ERROR';
  const error = new Error('Mail gateway request failed');
  Object.defineProperties(error, {
    name: { enumerable: true, configurable: true, value: 'MailGatewayError' },
    code: { enumerable: true, configurable: true, value: stableCode },
    retryable: { enumerable: true, configurable: true, value: Boolean(retryable) },
    statusCode: { enumerable: true, configurable: true, value: statusFor(stableCode) },
  });
  return error;
}

function requireEnabled() {
  if (String($os.getenv('MAIL_GATEWAY_ENABLED') || '').trim().toLowerCase() !== 'true') {
    throw gatewayError('MAIL_NOT_CONFIGURED', false);
  }
}

function internalBaseUrl() {
  const value = String($os.getenv('MAIL_GATEWAY_INTERNAL_URL') || '').trim();
  const match = /^http:\/\/([^\/:?#]+|\[[0-9A-Fa-f:]+\])(?::([0-9]{1,5}))?$/.exec(value);
  if (!match || !isInternalHost(match[1]) || !validPort(match[2])) {
    throw gatewayError('MAIL_NOT_CONFIGURED', false);
  }
  return value;
}

function validPort(value) {
  if (!value) return true;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}

function isInternalHost(value) {
  const host = value.toLowerCase();
  if (host === 'localhost' || host === '[::1]') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return validIpv4(host);
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return validIpv4(host);
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return validIpv4(host);
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) return validIpv4(host);
  if (host === 'admin-auth') return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:internal|local)$/.test(host);
}

function validIpv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(function (part) {
    return /^\d{1,3}$/.test(part) && Number(part) <= 255;
  });
}

function signedRequest(method, path, rawBody) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = $security.randomStringWithAlphabet(
    32,
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  );
  let baseUrl;
  let signature;
  try {
    baseUrl = internalBaseUrl();
    signature = crypto.sign(method, path, rawBody, timestamp, nonce);
  } catch (error) {
    if (error && error.name === 'MailGatewayError') throw error;
    throw gatewayError('MAIL_NOT_CONFIGURED', false);
  }
  try {
    return $http.send({
      url: baseUrl + path,
      body: rawBody,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Mail-Timestamp': timestamp,
        'X-Mail-Nonce': nonce,
        'X-Mail-Signature': signature,
      },
      timeout: 12,
    });
  } catch (_) {
    throw gatewayError('INTERNAL_ERROR', true);
  }
}

function responseFailure(response) {
  const body = response && response.json;
  const failure = body && body.error;
  if (
    body
    && body.ok === false
    && failure
    && STABLE_CODES[failure.code]
    && typeof failure.retryable === 'boolean'
  ) {
    return gatewayError(failure.code, failure.retryable);
  }
  return gatewayError('INTERNAL_ERROR', false);
}

function successfulHttp(response) {
  return response
    && Number.isInteger(response.statusCode)
    && response.statusCode >= 200
    && response.statusCode < 300;
}

function send(message) {
  requireEnabled();
  let rawBody;
  try {
    rawBody = JSON.stringify(message);
  } catch (_) {
    throw gatewayError('PAYLOAD_INVALID', false);
  }
  if (typeof rawBody !== 'string') {
    throw gatewayError('PAYLOAD_INVALID', false);
  }
  const response = signedRequest('POST', SEND_PATH, rawBody);
  const body = response && response.json;
  if (
    successfulHttp(response)
    && body
    && body.ok === true
    && typeof body.requestId === 'string'
    && body.requestId.length > 0
  ) {
    return { ok: true, requestId: body.requestId };
  }
  throw responseFailure(response);
}

function status() {
  requireEnabled();
  const response = signedRequest('GET', STATUS_PATH, '');
  const body = response && response.json;
  if (!successfulHttp(response) || !validStatus(body)) {
    throw responseFailure(response);
  }
  return {
    configured: body.configured,
    port: body.port,
    fromDomain: body.fromDomain,
    tlsMode: body.tlsMode,
    providerLabel: body.providerLabel,
    lastVerify: body.lastVerify,
    checkedAt: body.checkedAt,
  };
}

function validStatus(body) {
  return body
    && typeof body.configured === 'boolean'
    && typeof body.port === 'number'
    && typeof body.fromDomain === 'string'
    && typeof body.tlsMode === 'string'
    && typeof body.providerLabel === 'string'
    && (body.lastVerify === null || typeof body.lastVerify === 'string')
    && typeof body.checkedAt === 'string';
}

module.exports = {
  send,
  status,
};