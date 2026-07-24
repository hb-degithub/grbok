import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWebAuthnService } from '../src/webauthn-service.mjs';

describe('webauthn-service', () => {
  let calls = [];
  let service;

  before(() => {
    const adapter = {
      generateRegistrationOptions: async (opts) => {
        calls.push({ method: 'generateRegistrationOptions', opts });
        return { options: opts };
      },
      verifyRegistrationResponse: async (opts) => {
        calls.push({ method: 'verifyRegistrationResponse', opts });
        return { verified: true, registrationInfo: { credential: { id: 'cred-id', publicKey: new Uint8Array([1, 2, 3]), counter: 0 } } };
      },
      generateAuthenticationOptions: async (opts) => {
        calls.push({ method: 'generateAuthenticationOptions', opts });
        return { options: opts };
      },
      verifyAuthenticationResponse: async (opts) => {
        calls.push({ method: 'verifyAuthenticationResponse', opts });
        return { verified: true, authenticationInfo: { newCounter: 1 } };
      },
    };

    service = createWebAuthnService(adapter, {
      rpName: 'Test Blog',
      rpId: 'hlydwz.com',
      origin: 'https://hlydwz.com',
    });
  });


  it('registrationOptions passes RP ID, origin fields, and required user verification', async () => {
    calls.length = 0;
    await service.registrationOptions({ userId: 'user123', userName: 'admin@example.com', challenge: 'challenge-123' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'generateRegistrationOptions');
    assert.equal(calls[0].opts.rpName, 'Test Blog');
    assert.equal(calls[0].opts.rpID, 'hlydwz.com');
    assert.equal(calls[0].opts.userName, 'admin@example.com');
    assert.equal(calls[0].opts.userVerification, 'required');
  });

  it('verifyRegistration forwards response and expected values', async () => {
    calls.length = 0;
    const response = { id: 'cred-id', rawId: 'raw', response: {} };
    const result = await service.verifyRegistration({ response, expectedChallenge: 'challenge-123' });
    assert.equal(calls[0].method, 'verifyRegistrationResponse');
    assert.equal(calls[0].opts.response, response);
    assert.equal(calls[0].opts.expectedChallenge, 'challenge-123');
    assert.equal(calls[0].opts.expectedOrigin, 'https://hlydwz.com');
    assert.equal(calls[0].opts.expectedRPID, 'hlydwz.com');
    assert.equal(calls[0].opts.requireUserVerification, true);
    assert.equal(result.registrationInfo.credential.publicKey, 'AQID');
  });

  it('authenticationOptions passes challenge, allowCredentials, and required user verification', async () => {
    calls.length = 0;
    const allowCredentials = [{ id: 'cred-id', type: 'public-key' }];
    await service.authenticationOptions({ challenge: 'auth-challenge', allowCredentials });
    assert.equal(calls[0].method, 'generateAuthenticationOptions');
    assert.equal(calls[0].opts.rpID, 'hlydwz.com');
    assert.equal(calls[0].opts.challenge, 'auth-challenge');
    assert.equal(calls[0].opts.allowCredentials, allowCredentials);
    assert.equal(calls[0].opts.userVerification, 'required');
  });

  it('verifyAuthentication forwards response and authenticator', async () => {
    calls.length = 0;
    const response = { id: 'cred-id', rawId: 'raw', response: {} };
    const authenticator = { credentialID: 'cred-id', credentialPublicKey: new Uint8Array([1, 2, 3]), counter: 0 };
    await service.verifyAuthentication({ response, expectedChallenge: 'auth-challenge', authenticator });
    assert.equal(calls[0].method, 'verifyAuthenticationResponse');
    assert.equal(calls[0].opts.response, response);
    assert.equal(calls[0].opts.expectedChallenge, 'auth-challenge');
    assert.equal(calls[0].opts.expectedOrigin, 'https://hlydwz.com');
    assert.equal(calls[0].opts.expectedRPID, 'hlydwz.com');
    assert.equal(calls[0].opts.authenticator, authenticator);
    assert.equal(calls[0].opts.requireUserVerification, true);
  });

  it('verifyAuthentication decodes base64 credentialPublicKey', async () => {
    calls.length = 0;
    const response = { id: 'cred-id', rawId: 'raw', response: {} };
    const authenticator = { credentialID: 'cred-id', credentialPublicKey: 'AQID', counter: 0 };
    await service.verifyAuthentication({ response, expectedChallenge: 'auth-challenge', authenticator });
    assert.equal(calls[0].method, 'verifyAuthenticationResponse');
    assert.ok(calls[0].opts.authenticator.credentialPublicKey instanceof Buffer);
    assert.deepEqual([...calls[0].opts.authenticator.credentialPublicKey], [1, 2, 3]);
  });
});

