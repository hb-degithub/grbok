import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadAdminSecurityModule() {
  // TOTP 重构（commit fb787f0）删除了 admin_security.js，loopback/恢复审计逻辑
  // 迁移到 admin_totp_security.js；这里改读新位置以继续覆盖原语义。
  const source = await readFile(new URL('../../pb_hooks/lib/admin_totp_security.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require() { return {}; },
    $os: { getenv() { return ''; } },
  });
  vm.runInContext(source, context, { filename: 'admin_totp_security.js' });
  return module.exports;
}

test('local recovery accepts only real loopback addresses', async () => {
  const security = await loadAdminSecurityModule();
  for (const value of ['127.0.0.1', '127.31.42.9', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
    assert.equal(security.isLoopbackAddress(value), true, value);
  }
  for (const value of ['', 'localhost', '203.0.113.7', '10.0.0.1', '::ffff:203.0.113.7']) {
    assert.equal(security.isLoopbackAddress(value), false, value);
  }
});

test('local recovery audit records the actual PocketBase admin as a pseudonymous actor', async () => {
  // 恢复审计源码同样迁至 admin_totp_security.js（admin_security.js 已删除）。
  const securitySource = await readFile(new URL('../../pb_hooks/lib/admin_totp_security.js', import.meta.url), 'utf8');
  const auditSource = await readFile(new URL('../../pb_hooks/lib/admin_security_audit.js', import.meta.url), 'utf8');
  const migrationSource = await readFile(new URL('../../pb_migrations/20260716100600_add_admin_audit_actor.pb.js', import.meta.url), 'utf8');
  assert.match(securitySource, /actorType:\s*'pb_admin'/);
  assert.match(securitySource, /admin-audit-actor:/);
  assert.match(auditSource, /record\.set\('actor_type'/);
  assert.match(auditSource, /record\.set\('actor_reference'/);
  assert.match(migrationSource, /name:\s*'actor_type'/);
  assert.match(migrationSource, /name:\s*'actor_reference'/);
});

async function loadAdminStepUpModule() {
  const source = await readFile(new URL('../../pb_hooks/lib/admin_step_up.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  class ForbiddenError extends Error {}
  const hashSecret = 'h'.repeat(32);
  const selector = 's'.repeat(24);
  const rawSecret = 'r'.repeat(43);
  const values = {
    user: 'admin-user',
    revoked_at: '',
    expires_at: '2099-01-01T00:00:00.000Z',
    secret_hmac: `hash:step-up-secret:${rawSecret}:${hashSecret.length}`,
    client_session_hmac: `hash:step-up-client-session:client-session:${hashSecret.length}`,
    fingerprint_hash: `hash:step-up-fingerprint:fingerprint:${hashSecret.length}`,
    ip_hash: `hash:step-up-ip:203.0.113.8:${hashSecret.length}`,
    user_agent_hash: `hash:step-up-ua:test-agent:${hashSecret.length}`,
  };
  const record = { getString(name) { return values[name] || ''; } };
  const dao = { findRecordsByFilter() { return [record]; } };
  const context = vm.createContext({
    module,
    exports: module.exports,
    ForbiddenError,
    console: { error() {} },
    $app: { dao() { return dao; } },
    $apis: { requestInfo() { return {}; } },
    $os: { getenv(name) { return name === 'ADMIN_AUTH_HASH_SECRET' ? hashSecret : (name === 'ADMIN_IP' ? '203.0.113.8' : ''); } },
    $security: {
      randomStringWithAlphabet() { return 'x'.repeat(22); },
      hs256(input, secret) { return `hash:${input}:${secret.length}`; },
      equal(left, right) { return left === right; },
    },
    // requireAdminStepUp 通过 require('./client_ip.js').clientIp(c) 取真实 IP。
    // 沙箱里没有真实 HTTP 层，桩成回退 realIP() —— stepUpContext 即通过 realIP() 注入测试预设 IP，
    // 让执行流能穿过四要素校验进入 requireTrustedAdminIp 分支，从而断言 ADMIN_NETWORK_DENIED。
    require(name) {
      if (name === './client_ip.js') {
        return { clientIp(c) { return String((c && typeof c.realIP === 'function') ? c.realIP() : '').trim(); } };
      }
      return {};
    },
  });
  vm.runInContext(source, context, { filename: 'admin_step_up.js' });
  return { stepUp: module.exports, dao, selector, rawSecret };
}

function stepUpContext({ role = 'super_admin', verified = true, ip = '203.0.113.8' } = {}, selector, rawSecret) {
  const headers = new Map([
    ['X-Admin-Step-Up', `v1.${selector}.${rawSecret}`],
    ['X-Admin-Session', 'client-session'],
    ['X-Browser-Fingerprint', 'fingerprint'],
    ['User-Agent', 'test-agent'],
  ]);
  return {
    auth: { id: 'admin-user', get(name) { return name === 'role' ? role : ''; }, verified() { return verified; } },
    realIP() { return ip; },
    request() { return { header: { get(name) { return headers.get(name) || ''; } } }; },
  };
}

test('security policy step-up requires verified super admin on the configured admin IP', async () => {
  const { stepUp, dao, selector, rawSecret } = await loadAdminStepUpModule();
  const options = { dao, requireVerifiedEmail: true, requireSuperAdmin: true, requireTrustedAdminIp: true };

  assert.throws(() => stepUp.requireAdminStepUp(stepUpContext({ role: 'admin' }, selector, rawSecret), options), /ADMIN_STEP_UP_REQUIRED/);
  assert.throws(() => stepUp.requireAdminStepUp(stepUpContext({ verified: false }, selector, rawSecret), options), /ADMIN_STEP_UP_REQUIRED/);
  assert.throws(() => stepUp.requireAdminStepUp(stepUpContext({ ip: '203.0.113.99' }, selector, rawSecret), options), /ADMIN_NETWORK_DENIED/);
  assert.equal(stepUp.requireAdminStepUp(stepUpContext({}, selector, rawSecret), options).actorId, 'admin-user');

  const routeSource = await readFile(new URL('../../pb_hooks/security_policy_admin.pb.js', import.meta.url), 'utf8');
  assert.match(routeSource, /requireVerifiedEmail:\s*true/);
  assert.match(routeSource, /requireSuperAdmin:\s*true/);
  assert.match(routeSource, /requireTrustedAdminIp:\s*true/);
});
