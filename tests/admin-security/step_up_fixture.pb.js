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

    const suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const userA = createUser('stepupa', suffix);
    const userB = createUser('stepupb', suffix);
    const tokenA = $tokens.recordAuthToken($app, userA);
    const tokenB = $tokens.recordAuthToken($app, userB);
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
