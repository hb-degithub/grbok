import { createServer as createHttpServer } from 'node:http';
import { argv, env } from 'node:process';
import { pathToFileURL } from 'node:url';
import * as simpleWebAuthnAdapter from '@simplewebauthn/server';
import { createConfig } from './config.mjs';
import { createVerifiedSessionRecord, isVerifiedSessionValid } from './session-policy.mjs';
import { createWebAuthnService } from './webauthn-service.mjs';

export function createServer({ config, webauthnService }) {
  return createHttpServer(async (req, res) => {
    try {
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
      if (secret !== config.internalSecret) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const body = await readJson(req);
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
      console.error('admin-auth server error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
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
  });
  res.end(data);
}

export function startServer({
  config = createConfig(),
  adapter = simpleWebAuthnAdapter,
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
