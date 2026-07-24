# Frontend Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不扩大已批准范围的前提下，把当前前端分支合入 mail-security-integration，并补齐安全的 stats、friend-link、guestbook、gallery 后端契约。

**Architecture:** 访问统计和友链继续复用 page_views 与 stats_lib；访客标识改用 mail_crypto 的 HMAC。留言板复用 security_rate_policies/security_rate_buckets 的 SQLite 精确滚动窗口。相册复用现有 PocketBase RBAC、通用 Passkey step-up hook 和审计 hook，不新增第二套管理认证。

**Tech Stack:** PocketBase 0.22.21 JSVM、SQLite、Astro 6、React 19、PocketBase JS SDK、PowerShell 5 测试脚本。

## Global Constraints

- 设计来源：docs/superpowers/specs/2026-07-18-frontend-backend-integration-design.md。
- 不实现邮件订阅、项目后端或相册管理 UI。
- 不新增 npm 依赖。
- 生产业务代码只读 e.realIP()，不得回退到 X-Forwarded-For 或 X-Real-IP。
- page_views、guestbook_messages 和公开响应不得保存或返回原始 IP。
- guestbook_ip 默认 5/3600，后台 limit 只允许 1–10，windowSeconds 固定 3600。
- 普通 users API 的 gallery_items 管理写必须经过 RBAC、已验证邮箱、Passkey step-up；成功管理写必须进入脱敏审计。
- guestbook_messages 的 super_admin update/delete 也必须经过 Passkey step-up 和脱敏审计。
- PB superuser dashboard 是 ADMIN_IP 保护的独立可信运维平面，不伪称经过应用 Passkey；其成功管理写仍必须记录 HMAC actor 审计。
- 所有业务改动先 RED、再最小 GREEN、再重构和复审。
- 不部署生产，不发真实 SMTP，不调用真实 rclone，不处理 age 私钥，不 push 远端。
- 三个后端 Track 必须从同一合并后基线创建隔离 worktree；固定合并 S → G → P。

---

## File Map

共同基线：

- Merge: codex/page-usability-fixes → codex/mail-security-integration
- Modify: scripts/pre-deploy-check.ps1（只在三个 Track 合并后由主 Agent 接门禁）
- Modify: .superpowers/sdd/progress.md（最终证据）

Track S，统计与友链：

- Create: pb_migrations/20260718100000_extend_page_views_friend_target.pb.js
- Modify: pb_hooks/stats_track.pb.js
- Modify: pb_hooks/lib/stats_lib.js
- Modify: astro/src/components/stats/StatsDashboard.tsx
- Create: tests/frontend-backend/stats_friend_fixture.pb.js
- Create: scripts/test-stats-friend-local.ps1

Track G，留言板：

- Modify: pb_hooks/lib/security_policy_store.js
- Create: pb_migrations/20260718101000_create_guestbook_messages.pb.js
- Create: pb_hooks/validate_guestbook.pb.js
- Create: tests/frontend-backend/guestbook_fixture.pb.js
- Create: scripts/test-guestbook-local.ps1

Track P，相册与管理写横切安全：

- Create: pb_migrations/20260718102000_create_gallery_items.pb.js
- Create: pb_hooks/gallery_defaults.pb.js
- Modify: pb_hooks/lib/admin_step_up.js
- Modify: pb_hooks/audit_admin_actions.pb.js
- Create: tests/frontend-backend/gallery_security_fixture.pb.js
- Create: scripts/test-gallery-local.ps1

## Shared Interfaces

Track S produces:

~~~text
POST /api/track-view
pageview body:    { path, referrer?, event?: "pageview" }
link_click body: { path, event: "link_click", target }
success:         202 { ok: true }
invalid target:  400 { ok: false, error: "INVALID_TARGET" }
unavailable:     503 { ok: false, error: "TRACKING_UNAVAILABLE" }

GET /api/friend-link-stats
200 { range: "30d", top: Array<{ target: string, clicks: number }> }
~~~

Track G produces:

~~~text
collection guestbook_messages:
{ id, nickname, content, status: "show"|"hidden", created, updated }

policy guestbook_ip:
default { limit: 5, windowSeconds: 3600 }
bounds  { minLimit: 1, maxLimit: 10, minWindow: 3600, maxWindow: 3600 }
~~~

Track P produces:

~~~text
collection gallery_items:
{ id, photo, title?, description?, album?, sort_order?, status, created, updated }

file URL:
/api/files/gallery_items/{recordId}/{photo}
/api/files/gallery_items/{recordId}/{photo}?thumb=300x300
~~~

---

### Task 0: Freeze and verify the mail-security integration baseline

**Owner:** Main Agent

**Files:**

- Modify only the already reviewed integration security files.
- Create/keep the two 2026-07-18 spec/plan documents.

**Interfaces:**

- Produces: one clean codex/mail-security-integration commit that contains the reviewed A+B+C integration and shared security fixes.
- Consumes: current c9b8ade merge baseline and the existing dirty integration worktree.

- [ ] **Step 1: Record the exact dirty state**

Run:

~~~powershell
git status --short --branch
git diff --check
git log -6 --oneline --decorate
~~~

Expected: branch codex/mail-security-integration; only reviewed integration security files and these two documents are changed; git diff --check exits 0.

- [ ] **Step 2: Run focused mail-security checks**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-pre-deploy-runner.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-sensitive-check.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-offline-ci-contract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\sensitive-check.ps1
~~~

Expected: four commands exit 0; the sensitive scanner reports zero issues.

- [ ] **Step 3: Commit the reviewed baseline**

Run:

~~~powershell
$reviewedPaths = @(
  '.env.example'
  '.gitignore'
  'Caddyfile'
  'Caddyfile.local'
  'docker-compose.yml'
  'docker-compose.local.yml'
  'pb_hooks/account_mail.pb.js'
  'pb_hooks/lib/account_retention.js'
  'pb_hooks/lib/mail_outbox.js'
  'pb_hooks/mail_outbox.pb.js'
  'pb_hooks/security_rate_cleanup.pb.js'
  'pb_hooks/send_email_comment.pb.js'
  'scripts/check-admin-routes.ps1'
  'scripts/check-mail-config.ps1'
  'scripts/check-mail-security-env.ps1'
  'scripts/check-real-ip-chain.ps1'
  'scripts/pre-deploy-check.ps1'
  'scripts/sensitive-check.ps1'
  'scripts/test-admin-step-up.ps1'
  'scripts/test-security-rate-local.ps1'
  'scripts/test-offline-ci-contract.ps1'
  'scripts/test-pre-deploy-manifest.ps1'
  'scripts/test-pre-deploy-runner.ps1'
  'scripts/test-sensitive-check.ps1'
  'tests/mail-local/account_retention_fixture.pb.js'
  'tests/security-rate/hook_log_safety.test.js'
  'tests/security-rate/outbox_fixture.pb.js'
  'docs/superpowers/specs/2026-07-18-frontend-backend-integration-design.md'
  'docs/superpowers/plans/2026-07-18-frontend-backend-integration.md'
)
git add -- $reviewedPaths
git diff --cached --check
git commit -m "fix(mail): close integration security gates"
~~~

If final git status contains any path not listed above, review that path first and add it explicitly; never replace this allowlist with git add pb_hooks, git add scripts, git add tests or git add -A.

Expected: commit succeeds and git status --short is empty.

---

### Task 1: Merge the approved frontend branch into integration

**Owner:** Main Agent

**Files:**

- Merge all committed files from codex/page-usability-fixes.
- Resolve only real merge conflicts; preserve both mail security and frontend changes.

**Interfaces:**

- Consumes: clean Task 0 integration commit and frontend HEAD efba168 or its current descendant.
- Produces: the common baseline for Tracks S/G/P.

- [ ] **Step 1: Verify both tips and merge without touching main**

Run:

~~~powershell
git status --short
git log -1 --oneline codex/page-usability-fixes
git merge --no-ff codex/page-usability-fixes
~~~

Expected: merge commit on codex/mail-security-integration; no checkout, reset, push or production operation.

- [ ] **Step 2: Check the resolved contract surfaces**

Run:

~~~powershell
rg -n "track-view|blog-stats|friend-link-stats|guestbook_messages|gallery_items" astro\src pb_hooks pb_migrations
git diff HEAD^1..HEAD --check
~~~

Expected: page_views migration and stats hook exist; friend/guestbook/gallery frontend consumers exist; integration auth/security files remain present.

- [ ] **Step 3: Build the merged frontend**

Run:

~~~powershell
Set-Location astro
npm run build
~~~

Expected: exit 0 and dist includes stats, links, guestbook and gallery pages.

- [ ] **Step 4: Create isolated parallel worktrees**

Run from the repository root:

~~~powershell
git worktree add C:\tmp\mail-security-backend-stats-friend -b codex/mail-security-backend-stats-friend codex/mail-security-integration
git worktree add C:\tmp\mail-security-backend-guestbook -b codex/mail-security-backend-guestbook codex/mail-security-integration
git worktree add C:\tmp\mail-security-backend-gallery -b codex/mail-security-backend-gallery codex/mail-security-integration
~~~

Expected: all three branches point at the same Task 1 merge commit.

---

### Task 2: Track S — keyed stats identity and friend-link Top 10

**Owner:** Agent S

**Files:**

- Create: pb_migrations/20260718100000_extend_page_views_friend_target.pb.js
- Modify: pb_hooks/stats_track.pb.js
- Modify: pb_hooks/lib/stats_lib.js
- Modify: astro/src/components/stats/StatsDashboard.tsx
- Create: tests/frontend-backend/stats_friend_fixture.pb.js
- Create: scripts/test-stats-friend-local.ps1

**Interfaces:**

- Consumes: page_views, friend_links, mail_crypto.hashPrivate(), getPocketBase().
- Produces: target storage, validated link_click ingestion, friendLinkStats(e), authenticated stats frontend request.

- [ ] **Step 1: Write the failing fixture and runner**

The fixture must seed one show friend link, one hidden friend link and dated page_views, then assert:

~~~js
expect(track({ event: 'link_click', target: '' }).status, 400);
expect(track({ event: 'link_click', target: 'javascript:alert(1)' }).status, 400);
expect(track({ event: 'link_click', target: hiddenUrl }).status, 400);
expect(track({ event: 'link_click', target: unknownUrl }).status, 400);
expect(track({ event: 'link_click', target: showUrl }).status, 202);
expect(stats.range, '30d');
expect(stats.top[0].target, showUrl);
expect(stats.top[0].clicks, 3);
expect(JSON.stringify(stats).includes('visitor_hash'), false);
expect(untrustedHeaderOnlyWriteCount, 0);
expect(hashToday === hashTodayAgain, true);
expect(hashToday === hashTomorrow, false);
expect(hashToday === $security.sha256(rawIdentity), false);
expect(rateBucketKeysContainRawIp, false);
expect(storedReferrerForTokenUrl, 'https://ref.example');
expect(storedReferrerForNonHttp, '');
expect(storedReferrerForUserInfo, '');
expect(storedReferrerForControlChars, '');
~~~

The fixture/static contract must also reject stats log statements containing + error, error.message or interpolated exception values.

The runner must copy the repository hooks/migrations and fixture to a fresh temporary PocketBase directory, set test-only MAIL_HASH_SECRET, start on a free loopback port, call the fixture endpoint, then delete only its own temporary directory.

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-stats-friend-local.ps1
~~~

Expected RED: missing target field or missing friend-link-stats route.

- [ ] **Step 2: Add the target migration**

Implement an idempotent forward migration that preserves the existing field id when present:

~~~js
const views = dao.findCollectionByNameOrId('page_views');
ensureField(views, {
  name: 'target',
  type: 'text',
  required: false,
  options: { min: null, max: 500, pattern: '' },
});
views.indexes = (views.indexes || []).filter((sql) =>
  String(sql).indexOf('idx_page_views_event_target_created') === -1
).concat([
  'CREATE INDEX idx_page_views_event_target_created ON page_views (event, target, created)',
]);
dao.saveCollection(views);
~~~

The down migration removes only target and idx_page_views_event_target_created.

- [ ] **Step 3: Replace raw SHA-256 and header fallback**

At module top:

~~~js
const mailCrypto = require('./mail_crypto.js');
~~~

Replace getClientIP and visitor hash:

~~~js
function getClientIP(e) {
  try {
    return String(e.realIP() || '').trim();
  } catch (_) {
    return '';
  }
}

function visitorHash(ip, ua, day) {
  return mailCrypto.hashPrivate('stats-visitor-day', ip + '|' + ua + '|' + day);
}
~~~

Before rate limiting or saving:

~~~js
if (!ip) return e.json(503, { ok: false, error: 'TRACKING_UNAVAILABLE' });
~~~

Before isRateLimited(), derive the in-memory bucket subject with mailCrypto.hashPrivate('stats-rate-ip', ip); never build a globalThis key from raw IP.

Normalize referrer with one narrow helper:

~~~js
function safeReferrerOrigin(value) {
  if (typeof value !== 'string') return '';
  var source = value.trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return '';
  var match = /^(https?):\/\/([^\/?#\\\s]+)(?:[\/?#]|$)/i.exec(source);
  if (!match || !match[2] || match[2].indexOf('@') !== -1) return '';
  var origin = match[1].toLowerCase() + '://' + match[2];
  return origin.length <= 500 ? origin : '';
}
~~~

A valid URL with path/query/fragment stores only origin. Invalid scheme, userinfo, backslash, control characters or overlong origin stores an empty referrer while preserving the pageview.

Catch HMAC/config failures and return the same stable 503 without saving. Replace every raw stats exception log in local and production paths with fixed messages:

~~~js
console.error('[stats][STATS_TRACK_SAVE_FAILED]');
console.error('[stats][STATS_QUERY_FAILED]');
console.error('[stats][FRIEND_STATS_QUERY_FAILED]');
console.error('[stats][STATS_RETENTION_FAILED]');
~~~

No fixed message may append the caught exception, SQL, target, IP or request body.

- [ ] **Step 4: Validate friend-link targets before save**

Add:

~~~js
function validTargetShape(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 500
    && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(value);
}

function isVisibleFriendTarget(dao, target) {
  try {
    return !!dao.findFirstRecordByFilter(
      'friend_links',
      'status = "show" && url = {:target}',
      { target: target },
    );
  } catch (_) {
    return false;
  }
}
~~~

For link_click, reject unless both checks pass; set record.target only for link_click. For pageview, ignore any supplied target.

- [ ] **Step 5: Add the fixed 30-day aggregate**

Export friendLinkStats and register its route. Query shape:

~~~sql
SELECT pv.target, COUNT(*) AS clicks
FROM page_views pv
INNER JOIN friend_links fl ON fl.url = pv.target AND fl.status = 'show'
WHERE pv.event = 'link_click'
  AND pv.target != ''
  AND pv.created >= {:from}
GROUP BY pv.target
ORDER BY clicks DESC, pv.target ASC
LIMIT 10
~~~

Map rows exactly:

~~~js
return e.json(200, {
  range: '30d',
  top: rows.map((row) => ({
    target: String(row.target),
    clicks: Number(row.clicks),
  })),
});
~~~

Register:

~~~js
routerAdd('GET', '/api/friend-link-stats', function (e) {
  return require(__hooks + '/lib/stats_lib.js').friendLinkStats(e);
});
~~~

- [ ] **Step 6: Make StatsDashboard use PocketBase auth**

Replace raw fetch with:

~~~tsx
const pb = getPocketBase();
pb.send<StatsData>('/api/blog-stats', {
  method: 'GET',
  query: variant === 'admin'
    ? { range: '30d', detail: '1' }
    : { range: '30d' },
})
  .then(setData)
  .catch(() => setError(true));
~~~

Import getPocketBase from ../../lib/pocketbase and remove PB_URL.

- [ ] **Step 7: Run GREEN checks and commit**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-stats-friend-local.ps1
node --check pb_hooks\stats_track.pb.js
node --check pb_hooks\lib\stats_lib.js
Set-Location astro
npm run build
~~~

Expected: fixture PASS, both JS syntax checks exit 0, Astro build exits 0.

Commit:

~~~powershell
git add pb_migrations\20260718100000_extend_page_views_friend_target.pb.js pb_hooks\stats_track.pb.js pb_hooks\lib\stats_lib.js astro\src\components\stats\StatsDashboard.tsx tests\frontend-backend\stats_friend_fixture.pb.js scripts\test-stats-friend-local.ps1
git diff --cached --check
git commit -m "feat(stats): secure visit identity and friend ranking"
~~~

---

### Task 3: Track G — guestbook collection and durable exact quota

**Owner:** Agent G

**Files:**

- Modify: pb_hooks/lib/security_policy_store.js
- Create: pb_migrations/20260718101000_create_guestbook_messages.pb.js
- Create: pb_hooks/validate_guestbook.pb.js
- Create: tests/frontend-backend/guestbook_fixture.pb.js
- Create: scripts/test-guestbook-local.ps1

**Interfaces:**

- Consumes: security_rate_limit.consume(), normalizeIp(), security policy admin CAS.
- Produces: guestbook_messages and policy guestbook_ip.

- [ ] **Step 1: Write the failing fixture and runner**

The fixture must assert:

~~~js
expect(policy.limit, 5);
expect(policy.windowSeconds, 3600);
expect(bounds.minLimit, 1);
expect(bounds.maxLimit, 10);
expect(bounds.minWindow, 3600);
expect(bounds.maxWindow, 3600);
expect(publicVisibleStatuses, ['show']);
expect(publicUpdateStatus, 403);
expect(publicDeleteStatus, 403);
expect(firstFiveCreateStatuses, [200, 200, 200, 200, 200]);
expect(sixthCreateStatus, 429);
expect(afterWindowStatus, 200);
expect(successesFromTwentyConcurrent, 5);
expect(rawIpFoundInGuestbookRows, false);
expect(rawIpFoundInBucketRows, false);
~~~

Also corrupt events_json and verify the next create is 503 with zero new message.

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-guestbook-local.ps1
~~~

Expected RED: guestbook_messages or guestbook_ip does not exist.

- [ ] **Step 2: Extend the fixed policy set**

Add exactly:

~~~js
guestbook_ip: { limit: 5, windowSeconds: 3600 },
~~~

to DEFAULTS, and:

~~~js
guestbook_ip: {
  minLimit: 1,
  maxLimit: 10,
  minWindow: 3600,
  maxWindow: 3600,
},
~~~

to BOUNDS. Do not add dynamic keys or a disable value.

- [ ] **Step 3: Create the collection and policy migration**

Collection rules:

~~~js
messages.listRule = 'status = "show"';
messages.viewRule = 'status = "show"';
messages.createRule = '';
messages.updateRule = '@request.auth.role = "super_admin"';
messages.deleteRule = '@request.auth.role = "super_admin"';
~~~

Fields:

~~~js
ensureField(messages, { name: 'nickname', type: 'text', required: true, options: { min: 1, max: 30, pattern: '' } });
ensureField(messages, { name: 'content', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
ensureField(messages, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['show', 'hidden'] } });
~~~

Before inserting guestbook_ip, read all current policy rows. Require one positive shared version; insert guestbook_ip with that same version, updated_by=migration and current updated_at. If the set is inconsistent, throw so migration fails closed rather than resetting administrator policy.

The down migration deletes only guestbook_ip and guestbook_messages.

- [ ] **Step 4: Add the create hook**

Core flow:

~~~js
onRecordBeforeCreateRequest(function (e) {
  var rateLimit = require(__hooks + '/lib/security_rate_limit.js');
  var nickname = stripTags(e.record.get('nickname')).trim();
  var content = stripTags(e.record.get('content')).trim();
  if (!validNickname(nickname) || !validContent(content) || spam(content)) {
    throw new ApiError(400, 'GUESTBOOK_INVALID', { code: 'GUESTBOOK_INVALID' });
  }

  var ip;
  try { ip = rateLimit.normalizeIp(String(e.httpContext.realIP() || '').trim()); }
  catch (_) {
    throw new ApiError(503, 'GUESTBOOK_UNAVAILABLE', { code: 'GUESTBOOK_UNAVAILABLE' });
  }

  var decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: 'guestbook_ip', subject: ip }],
      });
    });
  } catch (_) {
    throw new ApiError(503, 'GUESTBOOK_UNAVAILABLE', { code: 'GUESTBOOK_UNAVAILABLE' });
  }
  if (!decision.allowed) {
    throw new ApiError(429, 'GUESTBOOK_RATE_LIMITED', {
      code: 'GUESTBOOK_RATE_LIMITED',
      retryAfter: decision.retryAfterSeconds,
    });
  }

  e.record.set('nickname', nickname);
  e.record.set('content', content);
  e.record.set('status', 'show');
  if (typeof e.next === 'function') e.next();
}, 'guestbook_messages');
~~~

spam(content) must reject C0 controls, three or more http/https links, and a character repeated 25 or more times. The hook must not set IP, hash, UA or fingerprint on the message record.

- [ ] **Step 5: Prove backend control remains constrained**

Extend the guestbook fixture to read getRatePolicySet(), replace the entire set with guestbook_ip limit 6 at the current version, and assert the sixth request becomes allowed. Then assert:

~~~js
expectCode(() => replace({ guestbook_ip: { limit: 0, windowSeconds: 3600 } }), 'POLICY_OUT_OF_SAFE_RANGE');
expectCode(() => replace({ guestbook_ip: { limit: 11, windowSeconds: 3600 } }), 'POLICY_OUT_OF_SAFE_RANGE');
expectCode(() => replace({ guestbook_ip: { limit: 5, windowSeconds: 1800 } }), 'POLICY_OUT_OF_SAFE_RANGE');
expectCode(() => replaceWithOldVersion(), 'POLICY_VERSION_CONFLICT');
~~~

- [ ] **Step 6: Run GREEN checks and commit**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-guestbook-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-security-rate-local.ps1 -All
node --check pb_hooks\validate_guestbook.pb.js
node --check pb_hooks\lib\security_policy_store.js
~~~

Expected: guestbook and all existing security-rate fixtures PASS.

Commit:

~~~powershell
git add pb_hooks\lib\security_policy_store.js pb_migrations\20260718101000_create_guestbook_messages.pb.js pb_hooks\validate_guestbook.pb.js tests\frontend-backend\guestbook_fixture.pb.js scripts\test-guestbook-local.ps1
git diff --cached --check
git commit -m "feat(guestbook): add durable controlled posting quota"
~~~

---

### Task 4: Track P — gallery RBAC, Passkey and audit

**Owner:** Agent P

**Files:**

- Create: pb_migrations/20260718102000_create_gallery_items.pb.js
- Create: pb_hooks/gallery_defaults.pb.js
- Modify: pb_hooks/lib/admin_step_up.js
- Modify: pb_hooks/audit_admin_actions.pb.js
- Create: tests/frontend-backend/gallery_security_fixture.pb.js
- Create: scripts/test-gallery-local.ps1

**Interfaces:**

- Consumes: requireProtectedWrite generic hooks, audit_admin_actions generic hooks, users roles.
- Produces: gallery_items with safe file schema and protected audited management writes.

- [ ] **Step 1: Write the failing migration/security fixture**

The runner must generate a local 1x1 PNG fixture and use a fresh PocketBase. The fixture/setup route may create test users and bound step-up records exactly as tests/admin-security/step_up_fixture.pb.js does.

Assert:

~~~js
expect(publicShowListCount, 1);
expect(publicHiddenListCount, 0);
expect(anonymousCreateStatus, 403);
expect(authorCreateWithoutStepUpStatus, 403);
expect(authorCreateWithStepUpStatus, 200);
expect(authorUpdateWithStepUpStatus, 200);
expect(authorDeleteWithStepUpStatus, 403);
expect(superAdminDeleteWithoutStepUpStatus, 403);
expect(superAdminDeleteWithStepUpStatus, 204);
expect(svgUploadStatus >= 400, true);
expect(oversizeUploadStatus >= 400, true);
expect(auditActions, ['create_gallery_items', 'update_gallery_items', 'delete_gallery_items']);
expect(auditContainsPhotoName, false);
expect(auditContainsDescription, false);
expect(auditContainsRawIp, false);
expect(auditContainsStepUpCredential, false);
expect(guestbookUpdateWithoutStepUpStatus, 403);
expect(guestbookUpdateWithStepUpStatus, 200);
expect(guestbookDeleteWithoutStepUpStatus, 403);
expect(guestbookDeleteWithStepUpStatus, 204);
expect(guestbookAuditContainsNicknameOrContent, false);
expect(pbAdminCreateWithoutApplicationStepUpStatus, 200);
expect(pbAdminAuditActorMatches, /^pb_admin:[a-f0-9]{64}$/);
~~~

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-gallery-local.ps1
~~~

Expected RED: gallery_items does not exist.

- [ ] **Step 2: Create gallery_items**

Use explicit safe MIME types:

~~~js
ensureField(gallery, {
  name: 'photo',
  type: 'file',
  required: true,
  options: {
    maxSelect: 1,
    maxSize: 10485760,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    thumbs: ['300x300'],
    protected: false,
  },
});
ensureField(gallery, { name: 'title', type: 'text', required: false, options: { min: null, max: 100, pattern: '' } });
ensureField(gallery, { name: 'description', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
ensureField(gallery, { name: 'album', type: 'text', required: false, options: { min: null, max: 50, pattern: '' } });
ensureField(gallery, { name: 'sort_order', type: 'number', required: false, options: { min: 0, max: null, noDecimal: true } });
ensureField(gallery, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['show', 'hidden'] } });
~~~

Rules:

~~~js
const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
const AUTHOR_RULE = '@request.auth.role = "author" || ' + ADMIN_RULE;
gallery.listRule = 'status = "show" || ' + AUTHOR_RULE;
gallery.viewRule = 'status = "show" || ' + AUTHOR_RULE;
gallery.createRule = AUTHOR_RULE;
gallery.updateRule = AUTHOR_RULE;
gallery.deleteRule = '@request.auth.role = "super_admin"';
~~~

Add indexes for status/sort_order/created and album/status. The down migration deletes only gallery_items.

- [ ] **Step 3: Normalize safe defaults**

gallery_defaults.pb.js:

~~~js
onRecordBeforeCreateRequest(function (e) {
  for (const field of ['title', 'description', 'album']) {
    e.record.set(field, String(e.record.get(field) || '').trim());
  }
  const status = String(e.record.get('status') || '').trim();
  e.record.set('status', status === 'hidden' ? 'hidden' : 'show');
  if (typeof e.next === 'function') e.next();
}, 'gallery_items');
~~~

Do not parse image bytes in JS; PocketBase file schema owns size/MIME/thumb validation.

- [ ] **Step 4: Add guestbook and gallery to the generic Passkey boundary**

Append guestbook_messages and gallery_items once to PROTECTED_COLLECTIONS:

~~~js
var PROTECTED_COLLECTIONS = [
  'posts', 'comments', 'tags', 'post_tags', 'users', 'friend_links',
  'announcements', 'media_assets', 'settings', 'post_versions',
  'guestbook_messages', 'gallery_items',
];
~~~

Do not special-case either collection or weaken requireAdminStepUp. Track P's fixture creates a minimal guestbook_messages fixture collection when Track G has not yet been merged, so this cross-cutting behavior is GREEN on its own branch and is rerun against the real Track G migration after S → G → P integration.

- [ ] **Step 5: Add safe audit labeling**

Append guestbook_messages and gallery_items once to ADMIN_MANAGED_COLLECTIONS. In recordLabel:

~~~js
if (collection === 'guestbook_messages') return record.id;
if (collection === 'gallery_items') {
  return String(record.get('title') || record.id).slice(0, 100);
}
~~~

Never use guestbook nickname/content or gallery photo/description as the label. Replace actingUser with an actingPrincipal helper that supports both principals without exposing PB admin identity:

~~~js
function actingPrincipal(e) {
  let info = null;
  try { info = $apis.requestInfo(e.httpContext); } catch (_) {}
  const user = (e && e.auth) || (info && (info.auth || info.authRecord)) || null;
  if (user) return { actorId: user.id, role: roleOf(user), kind: 'user' };

  let admin = info && info.admin ? info.admin : null;
  try { admin = admin || e.httpContext.get('admin') || null; } catch (_) {}
  if (!admin) return null;
  const secret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
  const adminId = String(admin.id || '').trim();
  if (secret.length < 32 || !adminId) return null;
  return {
    actorId: 'pb_admin:' + $security.hs256('admin-audit-actor:' + adminId, secret),
    role: 'pb_admin',
    kind: 'pb_admin',
  };
}
~~~

logEvent must use this principal. The generic requireProtectedWrite remains unchanged for PB admin, so the trusted dashboard path does not claim application Passkey verification.

Replace the existing raw audit catch:

~~~js
} catch (_) {
  console.error('[audit-write-failed] operation=write result=INTERNAL_ERROR');
}
~~~

A static regression must reject error.message, JSON.stringify(err), String(err) and exception interpolation in audit_admin_actions.pb.js.

- [ ] **Step 6: Run GREEN checks and commit**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-gallery-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-admin-step-up.ps1
node --check pb_hooks\gallery_defaults.pb.js
node --check pb_hooks\lib\admin_step_up.js
node --check pb_hooks\audit_admin_actions.pb.js
~~~

Expected: gallery fixture and existing admin step-up suite PASS.

Commit:

~~~powershell
git add pb_migrations\20260718102000_create_gallery_items.pb.js pb_hooks\gallery_defaults.pb.js pb_hooks\lib\admin_step_up.js pb_hooks\audit_admin_actions.pb.js tests\frontend-backend\gallery_security_fixture.pb.js scripts\test-gallery-local.ps1
git diff --cached --check
git commit -m "feat(gallery): enforce passkey RBAC and audit"
~~~

---

### Task 5: Merge Tracks S, G and P in the fixed order

**Owner:** Main Agent

**Files:**

- Merge Track commits into codex/mail-security-integration.
- Resolve conflicts without discarding user frontend or mail-security changes.

**Interfaces:**

- Consumes: reviewed Track S/G/P commits.
- Produces: one integrated branch with migrations ordered 20260718100000 → 20260718101000 → 20260718102000 as specified.

- [ ] **Step 1: Review and merge Track S**

Run:

~~~powershell
git merge --no-ff codex/mail-security-backend-stats-friend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-stats-friend-local.ps1
~~~

Expected: merge succeeds; stats/friend fixture PASS.

- [ ] **Step 2: Review and merge Track G**

Run:

~~~powershell
git merge --no-ff codex/mail-security-backend-guestbook
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-guestbook-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-security-rate-local.ps1 -All
~~~

Expected: both suites PASS; security policy set is not degraded.

- [ ] **Step 3: Review and merge Track P**

Run:

~~~powershell
git merge --no-ff codex/mail-security-backend-gallery
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-gallery-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-admin-step-up.ps1
~~~

Expected: both suites PASS, including real guestbook super_admin step-up/audit behavior after Track G is present.

- [ ] **Step 4: Check merge integrity**

Run:

~~~powershell
git status --short --branch
git diff --check
git log -12 --oneline --decorate
rg -n "guestbook_ip|gallery_items|friend-link-stats|stats-visitor-day" pb_hooks pb_migrations astro\src tests scripts
~~~

Expected: clean integration branch; all four contract markers exist exactly where planned.

---

### Task 6: Connect aggregate gates and run full verification

**Owner:** Main Agent

**Files:**

- Modify: scripts/pre-deploy-check.ps1
- Modify: .superpowers/sdd/progress.md

**Interfaces:**

- Consumes: all Track runners.
- Produces: one non-interactive -Ci command that includes all new backend regressions.

- [ ] **Step 1: Add the three new runners to pre-deploy**

Change totalStages from 25 to 28, then add three stages using the predeploy script's existing Invoke-PowerShellStage API:

~~~powershell
$frontendBackendOfflineArguments = if ($Ci) { @('-Offline') } else { @() }
Invoke-PowerShellStage 'stats/friend backend contracts' 'test-stats-friend-local.ps1' $frontendBackendOfflineArguments
Invoke-PowerShellStage 'guestbook durable quota' 'test-guestbook-local.ps1' $frontendBackendOfflineArguments
Invoke-PowerShellStage 'gallery passkey audit' 'test-gallery-local.ps1' $frontendBackendOfflineArguments
~~~

Each new runner must accept -Offline and fail before any download or network access when its local PocketBase binary is absent. Non-CI runs receive no -Offline argument.

- [ ] **Step 2: Run syntax and migration checks**

Run:

~~~powershell
$failed = 0
Get-ChildItem pb_hooks,pb_migrations,tests -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { $failed++ }
}
if ($failed -ne 0) { exit 1 }
~~~

Expected: every JS file parses.

- [ ] **Step 3: Run all focused suites**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-stats-friend-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-guestbook-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-gallery-local.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-security-rate-local.ps1 -All
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-admin-step-up.ps1
~~~

Expected: all commands exit 0.

- [ ] **Step 4: Build and scan**

Run:

~~~powershell
Set-Location astro
npm run build
Set-Location ..
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\sensitive-check.ps1
~~~

Expected: build succeeds; scanner reports zero issues, including astro/dist.

- [ ] **Step 5: Run the aggregate CI gate**

Run:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1 -Ci
~~~

Expected: exit 0; Windows-unavailable Bash/Docker/Linux checks are explicit SKIP rather than PASS.

- [ ] **Step 6: Update progress evidence**

Record exact merge SHAs, commands, pass counts and environment skips in .superpowers/sdd/progress.md. Do not record secrets, raw IPs, emails, local auth tokens or temporary fixture payloads.

---

### Task 7: Independent security review and branch handoff

**Owner:** Main Agent plus fresh review agents

**Files:**

- Review all changes from the Task 0 baseline to current integration HEAD.
- Create review artifacts only under .superpowers/sdd/security-audit-run-*.

**Interfaces:**

- Produces: validated finding set and final Critical/Important counts.

- [ ] **Step 1: Dispatch independent review lanes**

Assign separate reviewers:

1. Privacy/trusted-IP/keyed-hash and aggregate leakage.
2. SQLite rolling-window concurrency/CAS/migration correctness.
3. Gallery RBAC/Passkey/audit/file-upload security.

No reviewer may rely only on the implementing Agent’s report.

- [ ] **Step 2: Validate every finding against code and a reproducer**

Reject speculative findings without a reachable path. Fix all validated Critical and Important findings with a new failing regression first.

- [ ] **Step 3: Re-run full verification after the last fix**

Run:

~~~powershell
git diff --check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1 -Ci
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\sensitive-check.ps1
~~~

Expected: all exit 0 after the final code change.

- [ ] **Step 4: Final completion gate**

Completion is permitted only when:

- Critical = 0
- Important = 0
- integration worktree is clean
- no production/push/SMTP/rclone/age-private-key action occurred
- the exact environment limitations are documented

## Self-Review Record

- Spec coverage: stats auth/HMAC/realIP → Task 2; friend target/Top10 → Task 2; guestbook collection/SQLite policy/admin bounds/no raw IP → Task 3; gallery RBAC/Passkey/audit → Task 4; fixed parallel merge order → Tasks 1 and 5; full verification/review → Tasks 6 and 7.
- Scope exclusions: mail subscription, project backend and gallery UI are explicitly excluded in Global Constraints and no task creates them; PB superuser remains an audited trusted ops plane rather than a hidden application UI.
- Interface consistency: target, range/top/clicks, guestbook_ip and gallery_items field names match the design and current frontend consumers.
- Migration consistency: page_views base migration precedes target extension; guestbook and gallery use later unique timestamps.
- Placeholder scan: no deferred implementation marker or unspecified error handling remains; each behavior task has explicit RED/GREEN commands and stable acceptance results.
