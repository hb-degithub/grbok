/// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

routerAdd('GET', '/api/test/admin-step-up/run', function (c) {
  const baseUrl = 'http://127.0.0.1:18091';
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  const observed = [];
  const failures = [];

  function hash(secret, namespace, value) {
    return $security.hs256(namespace + ':' + value, secret);
  }

  function createUser(label, suffix) {
    const collection = $app.dao().findCollectionByNameOrId('users');
    const record = new Record(collection);
    record.set('email', label + '_' + suffix + '@example.local');
    record.set('username', label + '_' + suffix);
    record.set('password', 'Test12345!');
    record.set('passwordConfirm', 'Test12345!');
    record.set('name', label);
    record.set('role', 'super_admin');
    record.set('verified', true);
    record.refreshTokenKey();
    $app.dao().saveRecord(record);
    return record;
  }

  function createLegacySession(userId) {
    const collection = $app.dao().findCollectionByNameOrId('admin_verified_sessions');
    const record = new Record(collection);
    record.set('user', userId);
    record.set('token_hash', '0'.repeat(64));
    record.set('fingerprint_hash', '0'.repeat(64));
    record.set('ip_hash', '0'.repeat(64));
    record.set('user_agent_hash', '0'.repeat(64));
    record.set('verified_at', new Date().toISOString());
    record.set('expires_at', new Date(Date.now() + 15 * 60 * 1000).toISOString());
    record.set('revoked_at', '');
    $app.dao().saveRecord(record);
  }

  function createStepUp(userId, binding, secretKey) {
    const selector = $security.randomStringWithAlphabet(24, alphabet);
    const secret = $security.randomStringWithAlphabet(43, alphabet);
    const collection = $app.dao().findCollectionByNameOrId('admin_step_up_sessions');
    const record = new Record(collection);
    record.set('user', userId);
    record.set('selector', selector);
    record.set('secret_hmac', hash(secretKey, 'step-up-secret', secret));
    record.set('client_session_hmac', hash(secretKey, 'step-up-client-session', binding.clientSession));
    record.set('fingerprint_hash', hash(secretKey, 'step-up-fingerprint', binding.fingerprint));
    record.set('ip_hash', hash(secretKey, 'step-up-ip', binding.ip));
    record.set('user_agent_hash', hash(secretKey, 'step-up-ua', binding.userAgent));
    record.set('verified_at', new Date().toISOString());
    record.set('expires_at', new Date(Date.now() + 15 * 60 * 1000).toISOString());
    record.set('revoked_at', '');
    $app.dao().saveRecord(record);
    return { record: record, credential: 'v1.' + selector + '.' + secret };
  }

  function createSetting(suffix) {
    const collection = $app.dao().findCollectionByNameOrId('settings');
    const record = new Record(collection);
    record.set('key', 'step_up_fixture_' + suffix);
    record.set('value', { count: 0 });
    record.set('description', 'fixture');
    $app.dao().saveRecord(record);
    return record;
  }

  function createPasskey(userId, suffix, label) {
    const collection = $app.dao().findCollectionByNameOrId('admin_passkeys');
    const record = new Record(collection);
    record.set('owner', userId);
    record.set('label', label);
    record.set('credential_id', 'credential_' + suffix + '_' + label.toLowerCase());
    record.set('public_key', 'private-fixture-public-key-' + suffix + '-' + label);
    record.set('counter', 0);
    record.set('revoked_at', '');
    $app.dao().saveRecord(record);
    return record;
  }

  function createPasskeyState(userId) {
    const collection = $app.dao().findCollectionByNameOrId('admin_passkey_state');
    const record = new Record(collection);
    record.set('user', userId);
    record.set('bootstrapped_at', new Date().toISOString());
    $app.dao().saveRecord(record);
    return record;
  }

  function request(method, path, token, headers, body) {
    const requestHeaders = {
      Authorization: token,
      'Content-Type': 'application/json',
    };
    for (const key of Object.keys(headers || {})) requestHeaders[key] = headers[key];
    return $http.send({
      url: baseUrl + path,
      method: method,
      headers: requestHeaders,
      body: body === undefined ? '' : JSON.stringify(body),
      timeout: 10,
    });
  }

  function merge(base, overrides) {
    const result = {};
    for (const key of Object.keys(base)) result[key] = base[key];
    for (const key of Object.keys(overrides || {})) result[key] = overrides[key];
    return result;
  }

  function expect(label, response, status, code) {
    const raw = String(response.raw || '');
    observed.push({ label: label, status: response.statusCode, detail: raw.slice(0, 240) });
    if (response.statusCode !== status || (code && raw.indexOf(code) === -1)) {
      failures.push({ label: label, expected: status, actual: response.statusCode });
    }
  }

  try {
    const hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    if (hashSecret.length < 32) throw new Error('fixture hash secret missing');
    const legacyAfterCutover = $app.dao().findRecordsByFilter('admin_verified_sessions', 'id != ""', '', 10, 0);
    if (legacyAfterCutover.length !== 0) throw new Error('legacy verified sessions survived cutover');

    const suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const userA = createUser('stepupa', suffix);
    const userB = createUser('stepupb', suffix);
    const userC = createUser('stepupc', suffix);
    const userD = createUser('stepupd', suffix);
    const tokenA = $tokens.recordAuthToken($app, userA);
    const tokenB = $tokens.recordAuthToken($app, userB);
    const tokenC = $tokens.recordAuthToken($app, userC);
    const tokenD = $tokens.recordAuthToken($app, userD);
    createLegacySession(userA.id);
    createLegacySession(userB.id);

    const authProbe = request('POST', '/api/collections/users/auth-refresh', tokenA, {}, undefined);
    if (authProbe.statusCode !== 200) {
      throw new Error('auth probe failed: ' + authProbe.statusCode + ' ' + String(authProbe.raw || '').slice(0, 200));
    }

    const bindingA = {
      clientSession: $security.randomStringWithAlphabet(43, alphabet),
      fingerprint: 'fixture-fingerprint-a',
      ip: '127.0.0.1',
      userAgent: 'fixture-agent-a',
    };
    const stepUpA = createStepUp(userA.id, bindingA, hashSecret);
    const bindingC = {
      clientSession: $security.randomStringWithAlphabet(43, alphabet),
      fingerprint: 'fixture-fingerprint-c',
      ip: '127.0.0.1',
      userAgent: 'fixture-agent-c',
    };
    const stepUpC = createStepUp(userC.id, bindingC, hashSecret);
    const passkeyA1 = createPasskey(userA.id, suffix, 'Primary');
    const passkeyA2 = createPasskey(userA.id, suffix, 'Backup');
    createPasskeyState(userA.id);
    createPasskeyState(userB.id);
    const setting = createSetting(suffix);
    let updateCount = 0;

    function writeWith(input) {
      updateCount += 1;
      return request(
        'PATCH',
        '/api/collections/settings/records/' + setting.id,
        input.token,
        {
          'X-Admin-Step-Up': input.stepUp,
          'X-Admin-Session': input.clientSession,
          'X-Browser-Fingerprint': input.fingerprint,
          'User-Agent': input.userAgent,
        },
        { value: { count: updateCount } },
      );
    }

    const valid = {
      token: tokenA,
      stepUp: stepUpA.credential,
      clientSession: bindingA.clientSession,
      fingerprint: bindingA.fingerprint,
      userAgent: bindingA.userAgent,
    };

    expect('other actor', writeWith(merge(valid, { token: tokenB })), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('valid binding', writeWith(valid), 200);

    userA.refreshTokenKey();
    $app.dao().saveRecord(userA);
    const refreshedTokenA = $tokens.recordAuthToken($app, userA);
    expect('refreshed auth token', writeWith(merge(valid, { token: refreshedTokenA })), 200);

    expect('changed client session', writeWith(merge(valid, { token: refreshedTokenA, clientSession: 'changed-session' })), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('changed fingerprint', writeWith(merge(valid, { token: refreshedTokenA, fingerprint: 'changed-fingerprint' })), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('changed user agent', writeWith(merge(valid, { token: refreshedTokenA, userAgent: 'changed-agent' })), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('changed selector', writeWith(merge(valid, { token: refreshedTokenA, stepUp: 'v1.' + $security.randomStringWithAlphabet(24, alphabet) + '.' + $security.randomStringWithAlphabet(43, alphabet) })), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('changed secret', writeWith(merge(valid, { token: refreshedTokenA, stepUp: stepUpA.credential.replace(/[^.]+$/, $security.randomStringWithAlphabet(43, alphabet)) })), 403, 'ADMIN_STEP_UP_REQUIRED');

    const originalIpHash = stepUpA.record.getString('ip_hash');
    stepUpA.record.set('ip_hash', hash(hashSecret, 'step-up-ip', '203.0.113.99'));
    $app.dao().saveRecord(stepUpA.record);
    expect('changed real ip', writeWith(merge(valid, { token: refreshedTokenA })), 403, 'ADMIN_STEP_UP_REQUIRED');
    stepUpA.record.set('ip_hash', originalIpHash);
    $app.dao().saveRecord(stepUpA.record);

    stepUpA.record.set('expires_at', new Date(Date.now() - 60 * 1000).toISOString());
    $app.dao().saveRecord(stepUpA.record);
    expect('expired', writeWith(merge(valid, { token: refreshedTokenA })), 403, 'ADMIN_STEP_UP_REQUIRED');
    stepUpA.record.set('expires_at', new Date(Date.now() + 15 * 60 * 1000).toISOString());
    $app.dao().saveRecord(stepUpA.record);

    stepUpA.record.set('revoked_at', new Date().toISOString());
    $app.dao().saveRecord(stepUpA.record);
    expect('revoked', writeWith(merge(valid, { token: refreshedTokenA })), 403, 'ADMIN_STEP_UP_REQUIRED');
    stepUpA.record.set('revoked_at', '');
    $app.dao().saveRecord(stepUpA.record);

    expect(
      'safe self profile',
      request('PATCH', '/api/collections/users/records/' + userA.id, refreshedTokenA, {}, { name: 'Updated Fixture Name' }),
      200,
    );
    expect(
      'protected self role',
      request('PATCH', '/api/collections/users/records/' + userA.id, refreshedTokenA, {}, { role: 'admin' }),
      403,
      'ADMIN_STEP_UP_REQUIRED',
    );

    expect('direct passkey list denied', request('GET', '/api/collections/admin_passkeys/records', refreshedTokenA, {}, undefined), 403);
    expect('direct passkey update denied', request('PATCH', '/api/collections/admin_passkeys/records/' + passkeyA1.id, refreshedTokenA, {}, { label: 'Leaked update' }), 403);
    expect('direct passkey delete denied', request('DELETE', '/api/collections/admin_passkeys/records/' + passkeyA1.id, refreshedTokenA, {}, undefined), 403);

    const secureHeaders = {
      'X-Admin-Step-Up': stepUpA.credential,
      'X-Admin-Session': bindingA.clientSession,
      'X-Browser-Fingerprint': bindingA.fingerprint,
      'User-Agent': bindingA.userAgent,
    };
    const passkeyList = request('GET', '/api/blog-admin/passkeys', refreshedTokenA, secureHeaders, undefined);
    expect('dedicated passkey list', passkeyList, 200);
    if (passkeyList.statusCode === 200) {
      const parsedList = JSON.parse(String(passkeyList.raw || '{}'));
      const serialized = JSON.stringify(parsedList);
      if (serialized.indexOf('credential_id') !== -1 || serialized.indexOf('public_key') !== -1 || serialized.indexOf('private-fixture') !== -1) {
        failures.push({ label: 'sanitized passkey dto', expected: 'no credential material', actual: serialized.slice(0, 120) });
      }
    }

    expect('revoke non-last passkey', request('POST', '/api/blog-admin/passkeys/' + passkeyA2.id + '/revoke', refreshedTokenA, secureHeaders, {}), 200);
    expect('revoke last passkey denied', request('POST', '/api/blog-admin/passkeys/' + passkeyA1.id + '/revoke', refreshedTokenA, secureHeaders, {}), 409, 'LAST_PASSKEY_REQUIRED');

    const lockedStatus = request('GET', '/api/blog-admin/step-up/status', tokenB, {
      'X-Admin-Session': bindingA.clientSession,
      'X-Browser-Fingerprint': bindingA.fingerprint,
      'User-Agent': bindingA.userAgent,
    }, undefined);
    expect('bootstrapped zero-passkey cannot bootstrap', lockedStatus, 200);
    if (lockedStatus.statusCode === 200 && String(lockedStatus.raw || '').indexOf('bootstrap_required') !== -1) {
      failures.push({ label: 'bootstrapped zero-passkey cannot bootstrap', expected: 'non-bootstrap status', actual: String(lockedStatus.raw || '') });
    }

    expect('self delete without step-up denied', request('DELETE', '/api/collections/users/records/' + userC.id, tokenC, {}, undefined), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('self delete with exact step-up', request('DELETE', '/api/collections/users/records/' + userC.id, tokenC, {
      'X-Admin-Step-Up': stepUpC.credential,
      'X-Admin-Session': bindingC.clientSession,
      'X-Browser-Fingerprint': bindingC.fingerprint,
      'User-Agent': bindingC.userAgent,
    }, undefined), 204);

    expect('revoke audit failure', request('POST', '/api/blog-admin/step-up/revoke', refreshedTokenA, merge(secureHeaders, { 'X-Test-Fail-Audit': '1' }), {}), 503, 'ADMIN_CREDENTIAL_REVOKE_FAILED');
    expect('credential remains active after failed revoke', writeWith(merge(valid, { token: refreshedTokenA })), 200);
    expect('revoke current step-up', request('POST', '/api/blog-admin/step-up/revoke', refreshedTokenA, secureHeaders, {}), 200);
    expect('revoked credential immediately denied', writeWith(merge(valid, { token: refreshedTokenA })), 403, 'ADMIN_STEP_UP_REQUIRED');

    const bindingD = {
      clientSession: $security.randomStringWithAlphabet(43, alphabet),
      fingerprint: 'fixture-fingerprint-d',
      userAgent: 'fixture-agent-d',
    };
    const headersD = {
      'X-Admin-Session': bindingD.clientSession,
      'X-Browser-Fingerprint': bindingD.fingerprint,
      'User-Agent': bindingD.userAgent,
    };
    expect('bootstrap options first', request('POST', '/api/blog-admin/passkeys/registration/options', tokenD, headersD, {}), 200);
    expect('bootstrap options replacement', request('POST', '/api/blog-admin/passkeys/registration/options', tokenD, headersD, {}), 200);
    const bootstrapChallenges = $app.dao().findRecordsByFilter('webauthn_challenges', 'user = {:user} && purpose = "bootstrap_registration"', '', 10, 0, { user: userD.id });
    if (bootstrapChallenges.length !== 1) failures.push({ label: 'one bootstrap challenge per user/purpose', expected: 1, actual: bootstrapChallenges.length });
    expect('bootstrap verify succeeds once', request('POST', '/api/blog-admin/passkeys/registration/verify', tokenD, headersD, { response: { id: 'bootstrap_' + suffix }, label: 'Bootstrap' }), 200);
    expect('bootstrap verify replay denied', request('POST', '/api/blog-admin/passkeys/registration/verify', tokenD, headersD, { response: { id: 'bootstrap_' + suffix }, label: 'Bootstrap' }), 400);

    stepUpA.record.set('revoked_at', '');
    $app.dao().saveRecord(stepUpA.record);
    expect('add registration options bound to step-up', request('POST', '/api/blog-admin/passkeys/registration/options', refreshedTokenA, secureHeaders, {}), 200);
    expect('add verify changed client session denied', request('POST', '/api/blog-admin/passkeys/registration/verify', refreshedTokenA, merge(secureHeaders, { 'X-Admin-Session': 'changed-add-session' }), { response: { id: 'add_' + suffix }, label: 'Added' }), 403, 'ADMIN_STEP_UP_REQUIRED');
    expect('add verify original binding still succeeds', request('POST', '/api/blog-admin/passkeys/registration/verify', refreshedTokenA, secureHeaders, { response: { id: 'add_' + suffix }, label: 'Added' }), 200);

    if (failures.length > 0) {
      return c.json(500, { code: 'FIXTURE_ASSERTION_FAILED', failures: failures, observed: observed });
    }
    return c.json(200, { code: 'PASS', observed: observed });
  } catch (error) {
    return c.json(500, {
      code: 'FIXTURE_RUNTIME_FAILED',
      error: String(error && error.message ? error.message : error),
      observed: observed,
    });
  }
});

routerAdd('POST', '/api/test/admin-step-up/recovery/setup', function (c) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  const suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const users = $app.dao().findCollectionByNameOrId('users');
  const user = new Record(users);
  user.set('email', 'recovery_' + suffix + '@example.local');
  user.set('username', 'recovery_' + suffix);
  user.set('password', 'Test12345!');
  user.set('passwordConfirm', 'Test12345!');
  user.set('role', 'super_admin');
  user.set('verified', true);
  user.refreshTokenKey();
  $app.dao().saveRecord(user);

  const state = new Record($app.dao().findCollectionByNameOrId('admin_passkey_state'));
  state.set('user', user.id);
  state.set('bootstrapped_at', new Date(Date.now() - 86400000).toISOString());
  state.set('recovery_nonce_hmac', '');
  state.set('recovery_expires_at', '');
  $app.dao().saveRecord(state);

  for (const label of ['Primary', 'Backup']) {
    const passkey = new Record($app.dao().findCollectionByNameOrId('admin_passkeys'));
    passkey.set('owner', user.id);
    passkey.set('label', label);
    passkey.set('credential_id', 'recovery_' + suffix + '_' + label.toLowerCase());
    passkey.set('public_key', 'AQID');
    passkey.set('counter', 0);
    passkey.set('revoked_at', '');
    $app.dao().saveRecord(passkey);
  }

  const hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
  const clientSession = $security.randomStringWithAlphabet(43, alphabet);
  const fingerprint = 'recovery-fingerprint-' + suffix;
  const userAgent = 'recovery-agent-' + suffix;
  const selector = $security.randomStringWithAlphabet(24, alphabet);
  const secret = $security.randomStringWithAlphabet(43, alphabet);
  const session = new Record($app.dao().findCollectionByNameOrId('admin_step_up_sessions'));
  session.set('user', user.id);
  session.set('selector', selector);
  session.set('secret_hmac', $security.hs256('step-up-secret:' + secret, hashSecret));
  session.set('client_session_hmac', $security.hs256('step-up-client-session:' + clientSession, hashSecret));
  session.set('fingerprint_hash', $security.hs256('step-up-fingerprint:' + fingerprint, hashSecret));
  session.set('ip_hash', $security.hs256('step-up-ip:127.0.0.1', hashSecret));
  session.set('user_agent_hash', $security.hs256('step-up-ua:' + userAgent, hashSecret));
  session.set('verified_at', new Date().toISOString());
  session.set('expires_at', new Date(Date.now() + 900000).toISOString());
  session.set('revoked_at', '');
  $app.dao().saveRecord(session);

  return c.json(200, {
    userId: user.id,
    email: user.getString('email'),
    token: $tokens.recordAuthToken($app, user),
    clientSession,
    fingerprint,
    userAgent,
  });
});

routerAdd('POST', '/api/test/admin-step-up/recovery/check', function (c) {
  const input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
  const userId = String(input.userId || '');
  const activePasskeys = $app.dao().findRecordsByFilter('admin_passkeys', 'owner = {:user} && revoked_at = null', '', 100, 0, { user: userId });
  const activeStepUps = $app.dao().findRecordsByFilter('admin_step_up_sessions', 'user = {:user} && revoked_at = null', '', 100, 0, { user: userId });
  const states = $app.dao().findRecordsByFilter('admin_passkey_state', 'user = {:user}', '', 1, 0, { user: userId });
  const auditRows = $app.dao().findRecordsByFilter('admin_security_audits', 'target_id = {:user} && action_code = "ADMIN_LOCAL_RECOVERY" && priority = "high"', '', 100, 0, { user: userId });
  const state = states.length ? states[0] : null;
  return c.json(200, {
    activePasskeys: activePasskeys.length,
    activeStepUps: activeStepUps.length,
    bootstrapped: !!(state && state.getString('bootstrapped_at')),
    recoveryPending: !!(state && state.getString('recovery_nonce_hmac') && state.getString('recovery_expires_at')),
    audits: auditRows.length,
  });
});

routerAdd('POST', '/api/test/admin-step-up/bootstrap/setup', function (c) {
  const suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const users = $app.dao().findCollectionByNameOrId('users');
  const user = new Record(users);
  user.set('email', 'concurrent_' + suffix + '@example.local');
  user.set('username', 'concurrent_' + suffix);
  user.set('password', 'Test12345!');
  user.set('passwordConfirm', 'Test12345!');
  user.set('role', 'super_admin');
  user.set('verified', true);
  user.refreshTokenKey();
  $app.dao().saveRecord(user);
  return c.json(200, {
    userId: user.id,
    token: $tokens.recordAuthToken($app, user),
    clientSession: $security.randomStringWithAlphabet(43, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'),
    fingerprint: 'concurrent-fingerprint-' + suffix,
    userAgent: 'concurrent-agent-' + suffix,
  });
});

routerAdd('POST', '/api/test/admin-step-up/bootstrap/check', function (c) {
  const input = JSON.parse(readerToString(c.request().body, 4096) || '{}');
  const userId = String(input.userId || '');
  const challenges = $app.dao().findRecordsByFilter('webauthn_challenges', 'user = {:user}', '', 100, 0, { user: userId });
  const passkeys = $app.dao().findRecordsByFilter('admin_passkeys', 'owner = {:user} && revoked_at = null', '', 100, 0, { user: userId });
  const states = $app.dao().findRecordsByFilter('admin_passkey_state', 'user = {:user}', '', 10, 0, { user: userId });
  const audits = $app.dao().findRecordsByFilter('admin_security_audits', 'actor = {:user} && action_code = "ADMIN_PASSKEY_REGISTERED"', '', 100, 0, { user: userId });
  return c.json(200, { challenges: challenges.length, passkeys: passkeys.length, states: states.length, audits: audits.length });
});
