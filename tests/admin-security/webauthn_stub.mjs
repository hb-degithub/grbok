import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const port = Number(process.argv[2] || 18092);
const internalSecret = process.env.ADMIN_AUTH_INTERNAL_SECRET || '';
const hashSecret = process.env.ADMIN_AUTH_HASH_SECRET || '';

const hmac = (namespace, value) => createHmac('sha256', hashSecret).update(`${namespace}:${value}`).digest('hex');
const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
};

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
  if (req.headers['x-internal-secret'] !== internalSecret) return json(res, 403, { error: 'Forbidden' });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};

  if (req.url === '/internal/webauthn/registration/options') {
    return json(res, 200, { challenge: body.challenge, rp: { id: 'localhost', name: 'Fixture' }, user: { id: body.userId, name: body.userName, displayName: body.userName }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] });
  }
  if (req.url === '/internal/webauthn/registration/verify') {
    const id = String(body.response?.id || 'fixture-credential');
    return json(res, 200, { verified: true, registrationInfo: { credential: { id, publicKey: 'AQID', counter: 0 } } });
  }
  if (req.url === '/internal/webauthn/authentication/options') {
    return json(res, 200, { challenge: body.challenge, allowCredentials: body.allowCredentials, userVerification: 'required' });
  }
  if (req.url === '/internal/webauthn/authentication/verify') {
    return json(res, 200, { verified: true, authenticationInfo: { newCounter: Number(body.authenticator?.counter || 0) + 1 } });
  }
  if (req.url === '/internal/step-up/issue') {
    const selector = randomBytes(18).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const now = Date.now();
    return json(res, 200, {
      credential: `v1.${selector}.${secret}`,
      record: {
        user: body.userId,
        selector,
        secret_hmac: hmac('step-up-secret', secret),
        client_session_hmac: hmac('step-up-client-session', body.clientSession),
        fingerprint_hash: hmac('step-up-fingerprint', body.fingerprint),
        ip_hash: hmac('step-up-ip', body.ip),
        user_agent_hash: hmac('step-up-ua', body.userAgent),
        verified_at: new Date(now).toISOString(),
        expires_at: new Date(now + 15 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
    });
  }
  return json(res, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1');
