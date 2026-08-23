'use strict';

// 评论点赞防重回归测试（源码级，无外部依赖，node 直接运行）。

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');
var hookSource = fs.readFileSync(path.join(repoRoot, 'pb_hooks', 'lib', 'comment_actions_lib.js'), 'utf8');
var migrationSource = fs.readFileSync(
  path.join(repoRoot, 'pb_migrations', '20260820120000_create_comment_likes.pb.js'),
  'utf8'
);

// 1. 访客标识必须是服务端 HMAC，且原始 IP/User-Agent 不写入 comment_likes
assert(hookSource.indexOf('hashPrivate(') !== -1 && hookSource.indexOf("'comment-like'") !== -1, 'like handler must derive a scoped HMAC visitor hash');
assert(hookSource.indexOf("likeRecord.set('visitor_hash', visitorHash)") !== -1, 'like handler must store only visitor_hash');
assert(hookSource.indexOf("likeRecord.set('ip'") === -1, 'like record must not persist raw IP');
assert(hookSource.indexOf("likeRecord.set('user_agent'") === -1, 'like record must not persist raw User-Agent');

// 2. 重复点赞必须先查询幂等记录，并返回兼容响应中的 alreadyLiked 标志
assert(hookSource.indexOf("'comment_likes'") !== -1, 'like handler must use comment_likes collection');
assert(hookSource.indexOf("'comment = {:comment} && visitor_hash = {:hash}'") !== -1, 'dedupe lookup must use parameter binding');
assert(hookSource.indexOf('if (existing)') !== -1, 'like handler must short-circuit an existing like');
assert(hookSource.indexOf('response.alreadyLiked = true') !== -1, 'duplicate response must expose alreadyLiked without changing existing fields');

// 3. 并发安全依赖数据库唯一索引；错误处理只能在确有竞争记录时吞掉唯一冲突
assert(migrationSource.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_likes_unique') !== -1, 'migration must create a unique dedupe index');
assert(migrationSource.indexOf('(comment, visitor_hash)') !== -1, 'unique index must cover comment + visitor_hash');
assert(hookSource.indexOf('if (!racedLike) throw detailedError(503') !== -1, 'non-unique database errors must fail closed');

// 4. comment_likes 必须保持服务端私有，关联评论删除时级联清理
assert(migrationSource.indexOf('cascadeDelete: true') !== -1, 'comment relation must cascade on delete');
['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].forEach(function (rule) {
  assert(migrationSource.indexOf('likes.' + rule + ' = null') !== -1, rule + ' must deny public API access');
});

process.stdout.write('PASS comment likes are idempotent, private, and concurrency-safe\n');
