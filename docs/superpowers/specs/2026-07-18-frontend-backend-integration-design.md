# 前端功能后端补全与邮件安全集成设计

日期：2026-07-18

状态：已批准，等待按计划实施

目标分支：codex/mail-security-integration

前端来源分支：codex/page-usability-fixes（当前已审计提交 efba168）

## 1. 已批准范围

本轮先完成 mail-security-integration 中尚未提交的安全修复，再把当前前端分支合入 integration，最后补齐四组契约：

1. 访问统计：后台请求携带 PocketBase 身份；访客标识改为带密钥、按日轮换的 HMAC；客户端 IP 只接受 PocketBase e.realIP()。
2. 友链排行：page_views 增加 target；只接收当前公开友链的合法 http/https URL；提供固定 30 天 Top 10 聚合。
3. 留言板：创建 guestbook_messages；匿名公开创建、先展示后审；SQLite 精确滚动窗口默认每 IP 每小时 5 条，后台只能在硬边界内调整；数据库不保存原始 IP。
4. 相册：创建 gallery_items；公开只读 show；author 及以上创建/更新、仅 super_admin 删除；管理写入纳入现有 Passkey step-up 与审计。

明确不做：

- 不实现邮件订阅；订阅页只保留 RSS/Atom 能力。
- 不实现项目展示后端；项目页继续使用静态配置。
- 不新增相册管理 UI；本轮只交付数据模型、RBAC、step-up 和审计边界。
- 不部署生产，不发送真实 SMTP，不上传真实 rclone，不接触 age 私钥，不推送远端。
- 不重构现有 PocketBase/Astro 总体架构，不新增 npm 依赖。

## 2. 当前事实与集成前置条件

### 2.1 前端分支已经存在的契约

- pb_migrations/20260717120000_create_page_views.pb.js 已创建 page_views，字段包含 path、referrer、ua_category、visitor_hash、event。
- pb_hooks/stats_track.pb.js 与 pb_hooks/lib/stats_lib.js 已提供 POST /api/track-view、GET /api/blog-stats 和 90 天清理。
- astro/src/lib/track.ts 已把友链 target 通过 sendBeacon 发送给 /api/track-view。
- FriendLinkLeaderboard.tsx 已消费 GET /api/friend-link-stats，失败时安全降级为空态。
- GuestbookForm.tsx 直接创建 guestbook_messages；GuestbookBoard.tsx 只读取 status = "show"。
- GalleryBoard.tsx 读取 gallery_items，排序为 sort_order,-created，只展示 status = "show"，文件缩略图使用 thumb=300x300。
- StatsDashboard.tsx 当前用原生 fetch；credentials=include 不会自动携带 PocketBase Bearer token，因此 detail=1 的后台请求目前没有可靠身份。

### 2.2 integration 已有的可复用安全边界

- pb_hooks/lib/mail_crypto.js 的 hashPrivate(scope, value) 使用 MAIL_HASH_SECRET 做命名空间 HMAC。
- pb_hooks/lib/security_rate_limit.js 使用私有 SQLite security_rate_buckets，实现持久、原子、精确滚动窗口；subject_hash 为 HMAC，不保存原始 subject。
- pb_hooks/lib/security_policy_store.js 使用固定 key、全量 CAS 更新和硬边界；SecurityRatePolicyForm.tsx 自动枚举后端返回的 policies/bounds。
- pb_hooks/lib/admin_step_up.js 的 PROTECTED_COLLECTIONS 对 author/admin/super_admin 的管理写操作要求已验证邮箱和当前浏览器会话绑定的 Passkey step-up。
- pb_hooks/audit_admin_actions.pb.js 的 ADMIN_MANAGED_COLLECTIONS 对成功的已认证管理写入记录脱敏审计。
- security_policy_admin.pb.js 的策略修改要求 verified super_admin、可信 ADMIN_IP、Passkey step-up、CAS 和审计。

### 2.3 合并前置条件

必须先把 integration 当前邮件安全修复验证并提交，形成干净基线。随后本地合并 codex/page-usability-fixes；冲突只在 integration 分支解决。后端并行分支必须从该“邮件安全修复 + 前端”共同基线创建，禁止从旧 c9b8ade 或前端根分支各自开发。

## 3. 安全与隐私原则

1. 原始 IP 不进入 page_views、guestbook_messages、audit summary 或公开响应。
2. 访客和限流 subject 都使用带服务端密钥的 HMAC；普通 SHA-256 不作为匿名化边界。
3. 生产业务代码只读取 e.realIP()；不得回退到 X-Forwarded-For、X-Real-IP 或其他客户端可伪造 header。
4. 无可信 IP 时 fail closed：统计采集不落库；留言创建不落库。
5. 所有公开统计端点只返回聚合，不返回 visitor_hash、subject_hash、单条访问事件或桶内容。
6. 新管理写入复用现有 Passkey、RBAC 和审计，不另造第二套会话或秘密。
7. 所有迁移可在临时 PocketBase 数据目录前向应用；回滚只删除本迁移创建的字段、集合或 policy，不修改用户现有业务数据。
8. 错误响应使用稳定代码，不回传异常文本、SQL、文件名、IP、token、step-up header 或堆栈。

## 4. 访问统计设计

### 4.1 后台认证请求

StatsDashboard.tsx 统一通过 getPocketBase().send() 请求 /api/blog-stats。PocketBase SDK 自动带 Authorization token；公开变体也可使用相同调用但不要求登录。

请求：

- 公开：GET /api/blog-stats?range=30d
- 后台：GET /api/blog-stats?range=30d&detail=1

detail 仅在服务端确认当前 auth role 为 admin 或 super_admin 时返回；未认证或 author 请求仍只得到公开聚合，不以 403 暴露额外状态。

### 4.2 可信 IP 与访客 HMAC

stats_lib.js 的 getClientIP(e) 只允许：

~~~js
function getClientIP(e) {
  try {
    return String(e.realIP() || '').trim();
  } catch (_) {
    return '';
  }
}
~~~

visitor_hash 计算改为：

~~~js
mailCrypto.hashPrivate('stats-visitor-day', ip + '|' + userAgent + '|' + localDate)
~~~

其中 localDate 保持 YYYY-MM-DD 的日轮换语义。MAIL_HASH_SECRET 缺失、HMAC 失败或 IP 为空时返回 503：

~~~json
{ "ok": false, "error": "TRACKING_UNAVAILABLE" }
~~~

该请求不得创建 page_views 记录。

内存采集洪泛桶也不得用原始 IP 作 key，改用：

~~~js
mailCrypto.hashPrivate('stats-rate-ip', ip)
~~~

referrer 只允许 http/https，并只保存 scheme://host[:port]。路径、query、fragment、userinfo、控制字符、非 http(s) 或无法安全解析的输入全部剥离或置空；公开 topReferrers 不得出现 token/path 等客户端自由文本。

### 4.3 保留与公开聚合

- pageview 与 link_click 都继续保留 90 天；友链排行只读最近 30 天。
- GET /api/blog-stats 继续只聚合 event = pageview。
- visitor_hash 永不出现在任何响应。
- 现有内存 60 次/分钟采集洪泛桶可保留为非持久第一层；它不替代邮件/留言所用 SQLite 严格配额。

### 4.4 稳定运维日志

stats_lib.js 的本地和生产路径都不得拼接原始异常、error.message、SQL 或堆栈。四类失败只记录固定码：

- STATS_TRACK_SAVE_FAILED
- STATS_QUERY_FAILED
- FRIEND_STATS_QUERY_FAILED
- STATS_RETENTION_FAILED

## 5. 友链点击与排行设计

### 5.1 数据迁移

新增前向迁移 pb_migrations/20260718100000_extend_page_views_friend_target.pb.js：

- page_views.target：可选 text，max 500。
- 新索引覆盖 event、target、created，服务于固定 30 天聚合。
- 回滚只移除 target 字段和该索引，不删除 page_views。

### 5.2 POST /api/track-view 扩展

当 event = link_click 时：

1. target 必须是字符串，trim 后 1–500 字符。
2. 必须以 http:// 或 https:// 开头，不含空白或控制字符。
3. 必须精确匹配 friend_links 中 status = "show" 的 url。
4. 验证失败返回 400：

~~~json
{ "ok": false, "error": "INVALID_TARGET" }
~~~

5. 只有验证通过才把 target 写入 page_views。

当 event = pageview 时忽略客户端 target 并保持 target 为空。这样无法通过伪造 target 污染排行，也不会把任意外站 URL 变成公开排行榜链接。

### 5.3 GET /api/friend-link-stats

公开固定响应：

~~~json
{
  "range": "30d",
  "top": [
    { "target": "https://example.com", "clicks": 42 }
  ]
}
~~~

规则：

- 只统计近 30 天 event = link_click。
- 聚合时与当前 friend_links 做等值关联，只返回仍为 show 的 URL。
- clicks 降序；相同时 target 升序，确保结果稳定；最多 10 条。
- top 为空时仍返回 200 和空数组。
- 不接受 range、limit、target 等客户端查询参数，避免形成任意分析接口。
- 不返回 visitor_hash、UA、referrer、点击路径或单条事件。

## 6. 留言板设计

### 6.1 guestbook_messages

新增迁移 pb_migrations/20260718101000_create_guestbook_messages.pb.js：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| nickname | text | required，trim 后 1–30 |
| content | text | required，trim 后 1–500 |
| status | select | show/hidden，hook 强制公开创建为 show |
| created/updated | PocketBase 自动字段 | 自动 |

API 规则：

- listRule/viewRule：status = "show"
- createRule：公开
- updateRule/deleteRule：super_admin

不创建 ip、ip_hash、user_agent、email、fingerprint 或自由形式 moderation_log 字段。

### 6.2 持久精确滚动限流

固定 policy key：guestbook_ip。

- 默认：limit = 5，windowSeconds = 3600。
- 后台硬边界：limit 1–10；windowSeconds 固定 3600。
- subject：security_rate_limit.normalizeIp(e.realIP())。
- 存储：security_rate_buckets 只保存 policy 命名空间 HMAC 和升序事件时间戳。
- 一个创建请求只消费一个 guestbook_ip 桶。
- 并发、重启、清理任务均不能绕过配额。
- IP 不可信、policy 损坏、SQLite busy、事件 JSON 损坏或 HMAC secret 缺失时 fail closed，不创建留言。

新增 policy 时必须保持当前 policy set 的 version；不能把已被管理员更新的版本重置为 1。后台 PUT 仍要求全量 policy、CAS、可信管理网、verified super_admin、step-up 和审计。

### 6.3 校验和反垃圾

onRecordBeforeCreateRequest 只绑定 guestbook_messages，并按以下顺序执行：

1. 读取并 trim nickname/content；移除 HTML 标签。
2. 检查 nickname 1–30、content 1–500。
3. 拒绝 C0 控制字符、连续同字符 25 次及以上、超过 2 个 http/https 链接。
4. 读取且只读取 e.realIP()；为空即拒绝。
5. 在 SQLite 事务中消费 guestbook_ip。
6. 强制 status = show，把清理后的 nickname/content 写回 record。
7. 调用 e.next()。

稳定错误：

- 400 GUESTBOOK_INVALID
- 429 GUESTBOOK_RATE_LIMITED，data 中附 retryAfter
- 503 GUESTBOOK_UNAVAILABLE

前端现有通用失败 Toast 可继续工作；本轮不新增留言管理 UI。

guestbook_messages 的 super_admin update/delete 属于管理写：把该集合加入 PROTECTED_COLLECTIONS 和 ADMIN_MANAGED_COLLECTIONS。普通 users API 必须通过已验证邮箱和当前 Passkey step-up；审计标签只允许 record id，不得把 nickname、content、IP 或其他留言正文信息写入 summary。

## 7. 相册设计

### 7.1 gallery_items

新增迁移 pb_migrations/20260718102000_create_gallery_items.pb.js：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| photo | file | required，maxSelect 1，maxSize 10 MiB，只允许 JPEG/PNG/WebP/GIF，thumbs 包含 300x300，protected=false |
| title | text | 可选，max 100 |
| description | text | 可选，max 500 |
| album | text | 可选，max 50 |
| sort_order | number | 可选，非负整数 |
| status | select | show/hidden |

明确禁止 SVG，避免文件直链造成存储型 XSS。

API 规则：

- listRule/viewRule：status = "show"；author/admin/super_admin 可读取管理所需记录。
- createRule/updateRule：author、admin、super_admin。
- deleteRule：super_admin。

创建时 status 缺失由 gallery_defaults.pb.js 设为 show；title、description、album 统一 trim。上传失败或字段验证失败不写审计成功事件。

### 7.2 Passkey step-up

把 gallery_items 加入 admin_step_up.js 的 PROTECTED_COLLECTIONS。这样通过普通 collection API 发起的 author/admin/super_admin 创建、更新、删除，在 PocketBase RBAC 之外还必须满足：

- 当前用户邮箱已验证；
- 有效 X-Admin-Step-Up；
- X-Admin-Session、浏览器指纹、可信真实 IP、UA 与 step-up 记录一致；
- step-up 未过期且未撤销。

本轮不新增 gallery 管理 UI。运维人员使用 PocketBase 超级管理员控制台时，它是受 ADMIN_IP 保护、使用独立凭据的可信运维平面，不属于应用 users 的 author/admin/super_admin，也不伪称经过应用 Passkey。应用内角色写入必须走上述 Passkey 边界；PB superuser 写入仍必须进入审计。不得把 PB 超级管理员 token 暴露给前端。

### 7.3 审计

把 gallery_items 加入 audit_admin_actions.pb.js 的 ADMIN_MANAGED_COLLECTIONS，并为 recordLabel 增加安全标签：title 为空时用 record id；不得写 photo 文件名、description、step-up header 或完整 IP。

成功的已认证管理写入产生：

- create_gallery_items
- update_gallery_items
- delete_gallery_items

普通 users 主体用用户 id 和 role；PB superuser 主体从 requestInfo.admin 识别，actor 只保存 ADMIN_AUTH_HASH_SECRET 命名空间 HMAC，不保存 PB admin id 或邮箱。PB superuser 不要求应用 step-up，但每次 gallery 成功写入都记录 pb_admin 角色标记。

audit_logs 继续使用现有脱敏 IP 和受限 UA 字段。审计失败只记录固定 [audit-write-failed] operation=write result=INTERNAL_ERROR，不拼接 error.message、JSON.stringify(err)、堆栈或其他异常内容，也不把异常返回客户端。

## 8. 迁移与合并顺序

固定顺序：

1. 在 codex/mail-security-integration 完成并提交当前邮件安全修复。
2. 本地合并 codex/page-usability-fixes，解决冲突并完成构建/安全回归。
3. 从共同基线创建三个隔离 worktree：
   - Agent S：codex/mail-security-backend-stats-friend
   - Agent G：codex/mail-security-backend-guestbook
   - Agent P：codex/mail-security-backend-gallery
4. 三个 Agent 均先写失败测试，再实现、局部验证、自审；不得操作彼此 worktree。
5. 主 Agent 按 S → G → P 合并到 codex/mail-security-integration，逐次解决冲突和运行对应回归。
6. 主 Agent 最后接入 pre-deploy-check、跑全量 CI、敏感扫描和独立安全复审。

迁移顺序固定为：

1. 20260717120000_create_page_views（来自前端分支）
2. 20260718100000_extend_page_views_friend_target
3. 20260718101000_create_guestbook_messages
4. 20260718102000_create_gallery_items

## 9. 测试与完成标准

### 9.1 Stats/Friend

- 原始 fetch 不再用于后台 stats；PB SDK 请求在已登录时携带 token。
- 伪造 X-Forwarded-For/X-Real-IP 不影响 e.realIP() 结果。
- 同日同 IP+UA 得到相同 HMAC；跨日不同；HMAC 不等于普通 SHA-256。
- 缺失可信 IP 或 MAIL_HASH_SECRET 时零写入。
- link_click 缺 target、非 http(s)、超长、隐藏友链或不存在友链均 INVALID_TARGET 且零写入。
- 当前 show 友链点击按近 30 天 Top 10 聚合，历史隐藏友链不返回。
- 内存采集桶 key 是 HMAC，不含原始 IP。
- 含 token 的 referrer path/query 只留下 origin；userinfo、控制字符、非 http(s) 输入置空，公开 topReferrers 无原始自由文本。

### 9.2 Guestbook

- 公开只能读 show，公开不能更新/删除。
- 公开创建强制 show，HTML/控制字符/垃圾模式被拒绝。
- 同 IP 精确前 5 次成功、第 6 次 429；窗口边界后恢复。
- 20 个并发请求最多 5 个成功；PocketBase 重启后额度仍在。
- policy 后台可在 1–10 内修改；越界、旧 version、非可信网络或缺 step-up 被拒绝。
- guestbook_messages 与公开响应均不存在原始 IP；桶 subject_hash 为 64 位 HMAC。

### 9.3 Gallery

- 公开仅能列出/查看 show；匿名无法创建/更新/删除。
- author/admin/super_admin 无 step-up 的写入被拒绝。
- 有效 step-up 的 author/admin 可创建/更新，仍不能删除；有效 step-up 的 super_admin 可删除。
- SVG 和超 10 MiB 文件被拒绝；300x300 缩略图可生成。
- 成功写入有审计；失败写入无成功审计；审计中无文件名、description、原始 IP 或 header。
- guestbook 的 super_admin update/delete 缺 step-up 时拒绝；成功审计不含 nickname/content。
- PB superuser 从受信运维入口写入无需应用 Passkey，但产生不含 PB admin id/邮箱的 HMAC actor 审计。

### 9.4 全量门禁

- PowerShell/JS 语法检查通过。
- PocketBase 临时目录迁移与 fixture 全部通过。
- Astro npm run build 通过。
- scripts/pre-deploy-check.ps1 -Ci 通过；Windows 无 Bash/Docker 的项目明确标为 SKIP，不伪称 PASS。
- scripts/sensitive-check.ps1 对源码、Git 与 astro/dist 为零问题。
- 独立安全复审 Critical = 0、Important = 0。

## 10. 风险与明确限制

- 同一 NAT 下的匿名留言共享每小时 5 条额度，这是用户选择的严格安全取舍。
- 本地 SQLite 精确桶不解决分布式多实例写库；当前部署为单 PocketBase/共享 SQLite，扩容前必须重新设计。
- HMAC 仍属于可链接的短期标识，因此 stats 按日轮换、留言桶按窗口裁剪；不得用于跨系统画像。
- PocketBase 超级管理员控制台是独立运维平面，不等同于应用 super_admin；必须继续由 ADMIN_IP、独立凭据和最小授权保护。
- 生产真实迁移、SMTP、rclone、age 和远端保留语义需另行人工验收。
