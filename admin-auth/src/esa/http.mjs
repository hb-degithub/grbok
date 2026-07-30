import { describePurgeTasks, EsaError, purgeCaches } from './client.mjs';

const MAX_BODY_BYTES = 256 * 1024;

const authenticationFailure = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'INTERNAL_ERROR', retryable: false }),
});

// ESA 内网刷新通道：与 /internal/mail/* 共用同一套 HMAC 验签（X-Mail-* 头）
export function createEsaHttpHandler({ verifier }) {
  return {
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/internal/esa/')) return false;

      let rawBody;
      try {
        rawBody = await readRawBody(req);
      } catch (error) {
        if (isBodyTooLargeError(error)) {
          sendJson(res, 413, esaFailure('ESA_PAYLOAD_INVALID', false));
          return true;
        }
        sendJson(res, 500, authenticationFailure);
        return true;
      }

      try {
        const authentication = verifier({
          method: req.method,
          path: url.pathname,
          rawBody,
          timestamp: singleHeader(req.headers['x-mail-timestamp']),
          nonce: singleHeader(req.headers['x-mail-nonce']),
          signature: singleHeader(req.headers['x-mail-signature']),
        });
        if (authentication?.ok !== true) {
          sendJson(res, 401, authenticationFailure);
          return true;
        }
      } catch {
        sendJson(res, 401, authenticationFailure);
        return true;
      }

      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, authenticationFailure, { Allow: 'POST' });
          return true;
        }
        const payload = parseJsonObject(rawBody);
        switch (url.pathname) {
          case '/internal/esa/purge': {
            sendJson(res, 200, await purgeCaches({
              credentials: payload.credentials,
              type: payload.type,
              urls: payload.urls,
            }));
            return true;
          }
          case '/internal/esa/tasks': {
            sendJson(res, 200, await describePurgeTasks({
              credentials: payload.credentials,
              taskId: payload.taskId,
            }));
            return true;
          }
          default:
            sendJson(res, 404, authenticationFailure);
            return true;
        }
      } catch (error) {
        const stable = stableEsaError(error);
        sendJson(res, statusFor(stable.code), esaFailure(stable.code, stable.retryable));
        return true;
      }
    },
  };
}

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('ESA request body too large');
      error.code = 'ESA_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function singleHeader(value) {
  return typeof value === 'string' ? value : '';
}

function isBodyTooLargeError(error) {
  try {
    return error?.code === 'ESA_BODY_TOO_LARGE';
  } catch {
    return false;
  }
}

function parseJsonObject(rawBody) {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (error) {
    throw new EsaError('ESA_PAYLOAD_INVALID', false, error);
  }
}

function stableEsaError(error) {
  try {
    if (error instanceof EsaError && typeof error.retryable === 'boolean') {
      return { code: error.code, retryable: error.retryable };
    }
  } catch {
    // Hostile thrown values must not escape the stable HTTP error boundary.
  }
  return { code: 'INTERNAL_ERROR', retryable: false };
}

function statusFor(code) {
  if (code === 'ESA_PAYLOAD_INVALID' || code === 'ESA_INVALID_URL') return 400;
  if (code === 'ESA_RATE_LIMITED') return 429;
  if (code === 'ESA_NOT_CONFIGURED') return 503;
  if (code === 'INTERNAL_ERROR') return 500;
  return 503;
}

function esaFailure(code, retryable) {
  return { ok: false, error: { code, retryable: Boolean(retryable) } };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(data);
}
