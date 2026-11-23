import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 回归：评论必须登录后提交。
// 1) 迁移把 comments.createRule 收紧为 @request.auth.id != "" && post_id.status = "published"，
//    down 分支恢复匿名可提交的旧规则；
// 2) 迁移在 pb_migrations 中按文件名排序是最后一个写 comments.createRule 的迁移
//    （确保不会被更早的迁移覆盖，也不会被后续迁移静默放松）；
// 3) validate_comment.pb.js 仍保留邮箱验证门槛与作者关联逻辑——已登录用户的正常流程
//    不能被规则收紧改坏。

const AUTH_RULE = '@request.auth.id != "" && post_id.status = "published"';
const ANON_RULE = 'post_id.status = "published"';

const MIGRATIONS_DIR = new URL('../../pb_migrations/', import.meta.url);

function migrationSandbox(collection, captured) {
  return vm.createContext({
    migrate(up, down) {
      captured.up = up;
      captured.down = down;
    },
    Dao: class Dao {
      constructor(db) {
        this.db = db;
      }
      findCollectionByNameOrId(name) {
        if (name !== 'comments') throw new Error('unexpected collection: ' + name);
        return collection;
      }
      saveCollection(collectionToSave) {
        collectionToSave.saved = true;
      }
    },
    console: { log() {} },
  });
}

async function loadMigrationChain() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.pb.js')).sort();
  const chain = [];
  for (const file of files) {
    const source = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    if (!/comments\.createRule\s*=/.test(source)) continue;
    const captured = { up: null, down: null };
    const collection = { name: 'comments', createRule: '' };
    const context = migrationSandbox(collection, captured);
    vm.runInContext(source, context, { filename: file });
    assert.equal(typeof captured.up, 'function', file + ' must define an up migration');
    chain.push({ file, up: captured.up, down: captured.down, collection });
  }
  return chain;
}

test('the last comments.createRule migration requires an authenticated user', async () => {
  const chain = await loadMigrationChain();
  assert.ok(chain.length > 1, 'expected the historical comment rule migrations');
  const latest = chain[chain.length - 1];
  assert.match(latest.file, /require_auth_for_comments\.pb\.js$/, 'comment rule must be last set by the new migration');

  latest.up(null);
  assert.equal(latest.collection.createRule, AUTH_RULE);
  assert.ok(latest.collection.saved, 'migration must persist the collection');
});

test('the comments.createRule down migration restores anonymous submission', async () => {
  const chain = await loadMigrationChain();
  const latest = chain[chain.length - 1];

  latest.collection.createRule = AUTH_RULE;
  assert.equal(typeof latest.down, 'function', 'migration must provide a down branch');
  latest.down(null);
  assert.equal(latest.collection.createRule, ANON_RULE);
});

test('the rule still requires a published post and no longer accepts anonymous requests', async () => {
  const chain = await loadMigrationChain();
  const latest = chain[chain.length - 1];
  latest.up(null);
  const rule = latest.collection.createRule;

  assert.match(rule, /@request\.auth\.id\s*!=\s*""/, 'rule must require an authenticated requester');
  assert.match(rule, /post_id\.status\s*=\s*"published"/, 'rule must keep the published-post guard');
  assert.doesNotMatch(rule, /@request\.auth\.verified/, 'email verification stays in the hook, not the rule');
});

test('validate_comment.pb.js keeps the email-verification gate and owner linking for logged-in users', async () => {
  const source = await readFile(new URL('../../pb_hooks/validate_comment.pb.js', import.meta.url), 'utf8');

  // 已登录但邮箱未验证：仍需在钩子里被拒绝，并给出可读中文原因
  assert.match(source, /请先验证你的邮箱后再发表评论/, 'email verification gate must remain in the hook');
  // 已登录且邮箱匹配：落地 author_user 关联（登录用户评论的核心路径）
  assert.match(source, /record\.set\('author_user', ownerUser\.id\)/, 'verified owner must be linked to the comment');
  // 钩子不得自己拒绝「已登录」请求：登录态由 createRule 判定
  assert.doesNotMatch(source, /requireLogin|NOT_AUTHENTICATED|UNAUTHORIZED_COMMENT/, 'auth must be enforced by the rule, not a new hook error');
});
