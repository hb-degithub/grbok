import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { argv, env } from 'node:process';
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';
import { createConfig } from './config.mjs';
import { createMailConfig } from './mail/config.mjs';
import { createMailHttpHandler } from './mail/http.mjs';
import { createMailRequestVerifier } from './mail/request-auth.mjs';
import { createMailService } from './mail/service.mjs';
import { createMailTransport } from './mail/transport.mjs';
import { createGeoService } from './mail/geo.mjs';
import { createEsaHttpHandler } from './esa/http.mjs';
import { isVerifiedSessionValid } from './session-policy.mjs';
import { createStepUpCredential, verifyStepUpCredential } from './step-up-policy.mjs';

export function createServer({
  config,
  mailHttpHandler = { handle: async () => false },
  esaHttpHandler = { handle: async () => false },
  logger = console,
}) {
  const rateLimitMap = new Map();
  let lastRlCleanup = Date.now();

  // 仅当请求来源是可信代理时才采纳 X-Forwarded-For / X-Real-IP；
  // 否则伪造该头可让每个请求落到独立限流桶，完全绕过限速。
  // 可信来源：本机回环 + Docker 默认网桥网关（172.16.0.0/12 覆盖默认
  // bridge 与用户自定义 bridge；overlay 网关 10.x 不在此服务路径上）。
  const TRUSTED_PROXY_RANGES = [
    /^127\./,
    /^::1$/,
    /^172\.(1[6-9]|2\d|3[01])\./,
  ];

  function isTrustedProxy(ip) {
    return TRUSTED_PROXY_RANGES.some((re) => re.test(ip));
  }

  function clientIpForRateLimit(req) {
    const remote = req.socket.remoteAddress || '';
    if (isTrustedProxy(remote)) {
      const forwardedFor = req.headers['x-forwarded-for'];
      const realIp = req.headers['x-real-ip'];
      const candidate = (forwardedFor ? String(forwardedFor).split(',')[0].trim() : null)
        || (realIp ? String(realIp).trim() : null);
      if (candidate) return candidate;
    }
    return remote || 'unknown';
  }

  function isLegacyRateLimited(req, res) {
    const clientIp = clientIpForRateLimit(req);
    const now = Date.now();
    const rlKey = 'rl:' + clientIp;
    const rlEntry = rateLimitMap.get(rlKey);
    if (rlEntry && now - rlEntry.windowStart < 60000) {
      if (rlEntry.count >= 30) {
        sendJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      rlEntry.count++;
    } else {
      rateLimitMap.set(rlKey, { windowStart: now, count: 1 });
    }
    // 清理间隔需大于限流窗口（60s），避免窗口边界条目被漏清/误清
    if (now - lastRlCleanup > 2 * 60000) {
      lastRlCleanup = now;
      for (const [key, value] of rateLimitMap) {
        if (now - value.windowStart > 60000) rateLimitMap.delete(key);
      }
    }
    return false;
  }

  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/health' && req.method === 'GET') {
        if (isLegacyRateLimited(req, res)) return;
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (url.pathname.startsWith('/internal/mail/')) {
        const handled = await mailHttpHandler.handle(req, res, url);
        if (handled) return;
      }

      if (url.pathname.startsWith('/internal/esa/')) {
        const handled = await esaHttpHandler.handle(req, res, url);
        if (handled) return;
      }

      if (isLegacyRateLimited(req, res)) return;

      if (!url.pathname.startsWith('/internal/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      const secret = req.headers['x-internal-secret'];
      const expected = Buffer.from(config.internalSecret, 'utf8');
      const provided = Buffer.from(secret || '', 'utf8');
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        if (hasErrorMessage(err, 'PAYLOAD_TOO_LARGE')) throw err;
        sendJson(res, 400, { error: 'Invalid JSON' });
        return;
      }
      let result;

      switch (url.pathname) {
        case '/internal/session/verify': {
          const { record, token, fingerprint, ip, userAgent } = body;
          const valid = isVerifiedSessionValid(record, { token, fingerprint, ip, userAgent }, config.hashSecret);
          sendJson(res, 200, { verified: valid });
          return;
        }
        case '/internal/step-up/issue': {
          const { userId, clientSession, fingerprint, ip, userAgent } = body;
          if (!hasRequiredStrings({ userId, clientSession, fingerprint, ip, userAgent })) {
            sendJson(res, 400, { error: 'Invalid request' });
            return;
          }
          result = createStepUpCredential(
            { userId, clientSession, fingerprint, ip, userAgent },
            { hashSecret: config.hashSecret, sessionTtlSeconds: config.sessionTtlSeconds },
          );
          break;
        }
        case '/internal/step-up/verify': {
          const { record, userId, credential, clientSession, fingerprint, ip, userAgent } = body;
          if (!record || !hasRequiredStrings({ userId, credential, clientSession, fingerprint, ip, userAgent })) {
            sendJson(res, 400, { error: 'Invalid request' });
            return;
          }
          const verified = verifyStepUpCredential(
            record,
            { userId, credential, clientSession, fingerprint, ip, userAgent },
            config.hashSecret,
          );
          sendJson(res, 200, { verified });
          return;
        }
        default:
          sendJson(res, 404, { error: 'Not found' });
          return;
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (hasErrorMessage(err, 'PAYLOAD_TOO_LARGE')) {
        safelySendError(res, 413, { error: 'Request body too large' });
        return;
      }
      safelyLogServerError(logger, err);
      safelySendError(res, 500, { error: 'Internal server error' });
    }
  });
}

function hasRequiredStrings(values) {
  return Object.values(values).every((value) => typeof value === 'string' && value.length > 0);
}

async function readJson(req) {
  // Cap request body size to protect the internal service from memory
  // exhaustion via oversized JSON payloads. 1 MiB is far above any legitimate
  // WebAuthn options/assertion payload.
  const MAX_BODY_BYTES = 1 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text) return {};
  return JSON.parse(text);
}

function hasErrorMessage(error, expected) {
  try {
    return error?.message === expected;
  } catch {
    return false;
  }
}

function safelyLogServerError(logger, err) {
  try {
    if (logger && typeof logger.error === 'function') {
      const msg = err && typeof err.message === 'string' ? err.message : 'unknown';
      logger.error(`admin-auth server error: ${msg}`);
    }
  } catch {
    // Logging must not change the response or process outcome.
  }
}

function safelySendError(res, status, body) {
  try {
    if (res.writableEnded) return;
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, body);
  } catch {
    try {
      res.destroy();
    } catch {
      // The socket is already unusable; no further recovery is possible.
    }
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function startServer({
  config = createConfig(),
  // Bind to 0.0.0.0 so the PocketBase container can reach this service over
  // the Docker bridge network (PB connects to http://admin-auth:8787). This
  // is NOT a host exposure: docker-compose uses `expose:` (not `ports:`), so
  // 8787 is only reachable inside the Docker network. Every request is still
  // authenticated by the shared X-Internal-Secret. Do not change to 127.0.0.1
  // unless running admin-auth in the same network namespace as PocketBase.
  host = env.HOST || '0.0.0.0',
  port = parseInt(env.PORT || '8787', 10),
} = {}) {
  const mailConfig = createMailConfig(env);
  const mailTransport = createMailTransport({ config: mailConfig, nodemailer });
  // 请求级 SMTP 配置（PocketBase 后台下发）：按参数即时构建 config + transport，
  // 站点地址等基础设施项仍从环境变量继承。
  const createMailRuntime = (override) => {
    const cfg = createMailConfig({
      SMTP_HOST: override.host,
      SMTP_PORT: String(override.port),
      SMTP_USERNAME: override.username,
      SMTP_PASSWORD: override.password,
      SMTP_FROM_ADDRESS: override.fromAddress,
      SMTP_FROM_NAME: override.fromName,
      SMTP_TLS_MODE: override.tlsMode,
      SMTP_CONNECTION_TIMEOUT_MS: env.SMTP_CONNECTION_TIMEOUT_MS,
      SMTP_SOCKET_TIMEOUT_MS: env.SMTP_SOCKET_TIMEOUT_MS,
      PUBLIC_SITE_URL: env.PUBLIC_SITE_URL,
      NODE_ENV: env.NODE_ENV,
      MAIL_PROVIDER_LABEL: '阿里云邮件推送（后台配置）',
    });
    return { config: cfg, transport: createMailTransport({ config: cfg, nodemailer }) };
  };
  const mailService = createMailService({ config: mailConfig, transport: mailTransport, createRuntime: createMailRuntime });
  const mailVerifier = createMailRequestVerifier({ secret: config.mailInternalSecret });
  const geoService = createGeoService({ mmdbPath: env.GEO_MMDB_PATH });
  const mailHttpHandler = createMailHttpHandler({ verifier: mailVerifier, service: mailService, config: mailConfig, geo: geoService });
  // ESA 缓存刷新通道与邮件通道共用同一内网签名密钥（MAIL_INTERNAL_SECRET）
  const esaHttpHandler = createEsaHttpHandler({ verifier: mailVerifier });
  const server = createServer({ config, mailHttpHandler, esaHttpHandler });

  server.listen(port, host, () => {
    console.log(`admin-auth listening on ${host}:${port}`);
  });

  return server;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  startServer();
}
