import { MAIL_ERROR_CODES, MAIL_LIMITS } from './constants.mjs';
import { MailError } from './errors.mjs';
import { extractSmtpOverride, validateMailPayload } from './validation.mjs';

const authenticationFailure = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'INTERNAL_ERROR', retryable: false }),
});

export function createMailHttpHandler({ verifier, service, config }) {
  return {
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/internal/mail/')) return false;

      let rawBody;
      try {
        rawBody = await readRawBody(req);
      } catch (error) {
        if (isBodyTooLargeError(error)) {
          sendJson(res, 413, mailFailure('PAYLOAD_INVALID', false));
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
        switch (url.pathname) {
          case '/internal/mail/send': {
            if (!requireMethod(req, res, 'POST')) return true;
            const extracted = extractSmtpOverride(parseJsonObject(rawBody));
            sendJson(res, 200, await service.send(validateMailPayload(extracted.rest, config), extracted.smtp));
            return true;
          }
          case '/internal/mail/verify': {
            if (!requireMethod(req, res, 'POST')) return true;
            // 空 body = 测试环境变量配置；非空 body 必须是 {smtp: {...}}（后台下发的请求级配置）
            let override = null;
            if (rawBody.length !== 0) {
              const parsed = parseJsonObject(rawBody);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.smtp === undefined) {
                throw new MailError('PAYLOAD_INVALID', false);
              }
              override = extractSmtpOverride(parsed).smtp;
            }
            sendJson(res, 200, await service.verify(override));
            return true;
          }
          case '/internal/mail/status':
            if (!requireMethod(req, res, 'GET')) return true;
            requireEmptyBody(rawBody);
            sendJson(res, 200, await service.status());
            return true;
          default:
            sendJson(res, 404, authenticationFailure);
            return true;
        }
      } catch (error) {
        const stable = stableMailError(error);
        sendJson(res, statusFor(stable.code), mailFailure(stable.code, stable.retryable));
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
    if (total > MAIL_LIMITS.rawBodyBytes) {
      const error = new Error('Mail request body too large');
      error.code = 'MAIL_BODY_TOO_LARGE';
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
    return error?.code === 'MAIL_BODY_TOO_LARGE';
  } catch {
    return false;
  }
}

function parseJsonObject(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    throw new MailError('PAYLOAD_INVALID', false, error);
  }
}

function requireEmptyBody(rawBody) {
  if (rawBody.length !== 0) throw new MailError('PAYLOAD_INVALID', false);
}

function requireMethod(req, res, expected) {
  if (req.method === expected) return true;
  sendJson(res, 405, authenticationFailure, { Allow: expected });
  return false;
}

function stableMailError(error) {
  try {
    if (error instanceof MailError) {
      const code = error.code;
      const retryable = error.retryable;
      if (MAIL_ERROR_CODES.includes(code) && typeof retryable === 'boolean') {
        return { code, retryable };
      }
    }
  } catch {
    // Hostile thrown values must not escape the stable HTTP error boundary.
  }
  return { code: 'INTERNAL_ERROR', retryable: false };
}

function statusFor(code) {
  if (code === 'PAYLOAD_INVALID') return 400;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'RECIPIENT_PERMANENT') return 422;
  if (code === 'INTERNAL_ERROR') return 500;
  return 503;
}

function mailFailure(code, retryable) {
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
