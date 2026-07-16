import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadAdminSecurityModule() {
  const source = await readFile(new URL('../../pb_hooks/lib/admin_security.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require() { return {}; },
    $os: { getenv() { return ''; } },
  });
  vm.runInContext(source, context, { filename: 'admin_security.js' });
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
  const securitySource = await readFile(new URL('../../pb_hooks/lib/admin_security.js', import.meta.url), 'utf8');
  const auditSource = await readFile(new URL('../../pb_hooks/lib/admin_security_audit.js', import.meta.url), 'utf8');
  const migrationSource = await readFile(new URL('../../pb_migrations/20260716100600_add_admin_audit_actor.pb.js', import.meta.url), 'utf8');
  assert.match(securitySource, /actorType:\s*'pb_admin'/);
  assert.match(securitySource, /admin-audit-actor:/);
  assert.match(auditSource, /record\.set\('actor_type'/);
  assert.match(auditSource, /record\.set\('actor_reference'/);
  assert.match(migrationSource, /name:\s*'actor_type'/);
  assert.match(migrationSource, /name:\s*'actor_reference'/);
});
