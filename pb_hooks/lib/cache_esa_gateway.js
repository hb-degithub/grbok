'use strict';

// PB → admin-auth /internal/esa/* 内网调用
// 复用邮件通道同一套 HMAC 签名（X-Mail-* 头 + MAIL_INTERNAL_SECRET）。

var crypto = require('./mail_crypto.js');
var mailGateway = require('./mail_gateway.js');

var PURGE_PATH = '/internal/esa/purge';
var TASKS_PATH = '/internal/esa/tasks';

var STABLE_CODES = {
  ESA_NOT_CONFIGURED: true,
  ESA_PAYLOAD_INVALID: true,
  ESA_QUOTA_EXCEEDED: true,
  ESA_RATE_LIMITED: true,
  ESA_INVALID_URL: true,
  ESA_UPSTREAM_ERROR: true,
  INTERNAL_ERROR: true,
};

function statusFor(code) {
  if (code === 'ESA_PAYLOAD_INVALID' || code === 'ESA_INVALID_URL') return 400;
  if (code === 'ESA_RATE_LIMITED') return 429;
  if (code === 'INTERNAL_ERROR') return 500;
  return 503;
}

function gatewayError(code, retryable) {
  var stableCode = STABLE_CODES[code] ? code : 'INTERNAL_ERROR';
  var error = new Error('ESA gateway request failed');
  error.name = 'EsaGatewayError';
  error.code = stableCode;
  error.retryable = Boolean(retryable);
  error.statusCode = statusFor(stableCode);
  return error;
}

function signedRequest(path, payload) {
  var timestamp = String(Math.floor(Date.now() / 1000));
  var nonce = $security.randomStringWithAlphabet(
    32,
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  );
  var baseUrl;
  var rawBody;
  var signature;
  try {
    baseUrl = mailGateway._internalBaseUrl();
    rawBody = JSON.stringify(payload);
    signature = crypto.sign('POST', path, rawBody, timestamp, nonce);
  } catch (error) {
    if (error && error.name === 'EsaGatewayError') throw error;
    if (error && error.name === 'MailGatewayError') throw gatewayError('ESA_NOT_CONFIGURED', false);
    throw gatewayError('INTERNAL_ERROR', false);
  }
  try {
    return $http.send({
      url: baseUrl + path,
      body: rawBody,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mail-Timestamp': timestamp,
        'X-Mail-Nonce': nonce,
        'X-Mail-Signature': signature,
      },
      timeout: 15,
    });
  } catch (_) {
    throw gatewayError('ESA_UPSTREAM_ERROR', true);
  }
}

function unwrap(response) {
  var body = response && response.json;
  if (
    response
    && Number.isInteger(response.statusCode)
    && response.statusCode >= 200
    && response.statusCode < 300
    && body
    && body.ok === true
  ) {
    return body;
  }
  var failure = body && body.error;
  if (failure && STABLE_CODES[failure.code] && typeof failure.retryable === 'boolean') {
    throw gatewayError(failure.code, failure.retryable);
  }
  throw gatewayError('ESA_UPSTREAM_ERROR', false);
}

function purge(credentials, type, urls) {
  var body = unwrap(signedRequest(PURGE_PATH, {
    credentials: {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      siteId: credentials.siteId,
    },
    type: type,
    urls: urls,
  }));
  if (typeof body.taskId !== 'string' || !body.taskId) throw gatewayError('ESA_UPSTREAM_ERROR', true);
  return { taskId: body.taskId, requestId: String(body.requestId || '') };
}

function describeTasks(credentials, taskId) {
  var body = unwrap(signedRequest(TASKS_PATH, {
    credentials: {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      siteId: credentials.siteId,
    },
    taskId: taskId,
  }));
  return Array.isArray(body.tasks) ? body.tasks : [];
}

module.exports = {
  purge: purge,
  describeTasks: describeTasks,
};
