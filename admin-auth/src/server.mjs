import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { argv, env } from 'node:process';
import { pathToFileURL } from 'node:url';
import * as simpleWebAuthnAdapter from '@simplewebauthn/server';
import { createConfig } from './config.mjs';
import { createVerifiedSessionRecord, isVerifiedSessionValid } from './session-policy.mjs';
import { createWebAuthnService } from './webauthn-service.mjs';

export function createServer({ config, webauthnService }) {
  const rateLimitMap = new Map();
  let lastRlCleanup = Date.now();
  return createHttpServer(async (req, res) => {
    try {
      const clientIp = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const rlKey = 'rl:' + clientIp;
      const rlEntry = rateLimitMap.get(rlKey);
      if (rlEntry && now - rlEntry.windowStart < 60000) {
        if (rlEntry.count >= 30) {
          sendJson(res, 429, { error: 'Too many requests' });
          return;
        }
        rlEntry.count++;
      } else {
        rateLimitMap.set(rlKey, { windowStart: now, count: 1 });
      }
      if (now - lastRlCleanup > 5 * 60 * 1000) {
        lastRlCleanup = now;
        for (const [k, v] of rateLimitMap) {
          if (now - v.windowStart > 60000) rateLimitMap.delete(k);
        }
      }
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

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
        if (err && err.message === 'PAYLOAD_TOO_LARGE') throw err;
        sendJson(res, 400, { error: 'Invalid JSON' });
        return;
      }
      let result;

      switch (url.pathname) {
        case '/internal/webauthn/registration/options': {
          const { userId, userName, challenge } = body;
          result = await webauthnService.registrationOptions({ userId, userName, challenge });
          break;
        }
        case '/internal/webauthn/registration/verify': {
          const { response, expectedChallenge } = body;
          result = await webauthnService.verifyRegistration({ response, expectedChallenge });
          break;
        }
        case '/internal/webauthn/authentication/options': {
          const { challenge, allowCredentials } = body;
          result = await webauthnService.authenticationOptions({ challenge, allowCredentials });
          break;
        }
        case '/internal/session/verify': {
          const { record, token, fingerprint, ip, userAgent } = body;
          const valid = isVerifiedSessionValid(record, { token, fingerprint, ip, userAgent }, config.hashSecret);
          sendJson(res, 200, { verified: valid });
          return;
        }
        case '/internal/webauthn/authentication/verify': {
          const { response, expectedChallenge, authenticator, userId, token, fingerprint, ip, userAgent } = body;
          result = await webauthnService.verifyAuthentication({ response, expectedChallenge, authenticator });
          if (result.verified) {
            result.session = createVerifiedSessionRecord(
              { userId, token, fingerprint, ip, userAgent },
              { hashSecret: config.hashSecret, sessionTtlSeconds: config.sessionTtlSeconds }
            );
          }
          break;
        }
        default:
          sendJson(res, 404, { error: 'Not found' });
          return;
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err && err.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: 'Request body too large' });
        return;
      }
      console.error('admin-auth server error:', err.message || String(err));
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
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
  adapter = simpleWebAuthnAdapter,
  // Bind to 0.0.0.0 so the PocketBase container can reach this service over
  // the Docker bridge network (PB connects to http://admin-auth:8787). This
  // is NOT a host exposure: docker-compose uses `expose:` (not `ports:`), so
  // 8787 is only reachable inside the Docker network. Every request is still
  // authenticated by the shared X-Internal-Secret. Do not change to 127.0.0.1
  // unless running admin-auth in the same network namespace as PocketBase.
  host = env.HOST || '0.0.0.0',
  port = parseInt(env.PORT || '8787', 10),
} = {}) {
  const webauthnService = createWebAuthnService(adapter, config);
  const server = createServer({ config, webauthnService });

  server.listen(port, host, () => {
    console.log(`admin-auth listening on ${host}:${port}`);
  });

  return server;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  startServer();
}
