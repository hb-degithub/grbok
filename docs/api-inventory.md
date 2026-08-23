# API 接口清单

> 静态盘点日期：2026-08-21  
> 适用范围：Astro SSR、PocketBase hooks / 原生 REST、admin-auth 内部服务、Caddy 暴露边界。  
> 生产暴露面以 `Caddyfile` 与 `docker-compose.yml` 为准；集合访问规则以最新生效的 `pb_migrations/` 为准。

## 1. 总体架构

- Astro 没有 `astro/src/pages/api/` 目录，唯一自身 HTTP endpoint 是 `GET /feed.xml`。
- 业务 API 主要由 `pb_hooks/*.pb.js` 的 `routerAdd()` 提供。
- 生产 Caddy 将 `/api/*` 反向代理至 PocketBase `pocketbase:8090`。
- admin-auth 监听 `0.0.0.0:8787`，但 docker compose 仅使用 `expose`，没有宿主机端口映射，也没有 Caddy 转发，因此只在 docker 内网可达。
- `/api/blog-admin/*` 在网络层可达公网，安全边界由 PocketBase hook 内的角色、step-up 和可信管理 IP 校验承担。

## 2. 公网自定义 API

### 2.1 读者认证

| 方法 | 路径 | 访问要求 | 用途 | 实现 |
|---|---|---|---|---|
| POST | `/api/blog-auth/register` | 公网；注册模式与 IP 限流 | 读者注册 | `pb_hooks/blog_register.pb.js` |
| GET | `/api/blog-auth/registration/health` | 公网 | 注册链路健康检查 | `pb_hooks/blog_register.pb.js` |
| POST | `/api/blog-auth/password-reset/request` | 公网；统一 202 防枚举 | 请求密码重置邮件 | `pb_hooks/blog_auth.pb.js` |
| POST | `/api/blog-auth/verification/request` | 公网；5/IP/15min 等限流 | 重发邮箱验证邮件 | `pb_hooks/blog_auth.pb.js` |
| POST | `/api/blog-auth/email-change/request` | 预期为已登录用户 | 请求换绑邮箱邮件 | `pb_hooks/blog_auth.pb.js` |
| POST | `/api/blog-auth/otp/request` | 公网；限流 | 请求 OTP / 魔法链接 | `pb_hooks/blog_auth.pb.js` |
| POST | `/api/blog-auth/otp/verify` | challengeId + code | 验证 OTP 并签发登录态 | `pb_hooks/blog_auth.pb.js` |
| GET | `/api/blog-auth/mail/health` | 公网 | 邮件链路健康检查 | `pb_hooks/blog_auth.pb.js` |

### 2.2 评论、搜索与统计

| 方法 | 路径 | 访问要求 | 用途 | 实现 |
|---|---|---|---|---|
| POST | `/api/comments/:id/like` | 公网；IP 限流 + HMAC 访客指纹防重复 | 评论点赞 | `pb_hooks/comment_actions.pb.js` |
| POST | `/api/comments/:id/edit` | 登录用户本人；匿名用户邮箱 + 验证码 | 编辑评论 | `pb_hooks/comment_actions.pb.js` |
| POST | `/api/comments/:id/delete` | 同编辑评论 | 删除评论 | `pb_hooks/comment_actions.pb.js` |
| POST | `/api/comments/verification/send` | 公网；IP 限流 | 发送匿名评论操作验证码 | `pb_hooks/comment_actions.pb.js` |
| GET | `/api/search?q=<term>&limit=<n>` | 公网；只搜索 published 文章/标签 | 站内搜索 | `pb_hooks/search_api.pb.js` |
| GET | `/api/search/suggest` | 公网 | 搜索建议 | `pb_hooks/search_api.pb.js` |
| POST | `/api/track-view` | 公网；不保存原始 IP | 页面访问埋点 | `pb_hooks/stats_track.pb.js` |
| GET | `/api/blog-stats?range=<range>` | 公网；`detail=1` 需 admin/super_admin | 博客统计聚合 | `pb_hooks/stats_track.pb.js` |
| GET | `/api/friend-link-stats` | 公网 | 友链点击统计 | `pb_hooks/stats_track.pb.js` |

## 3. 管理端自定义 API

### 3.1 管理员会话与安全状态

| 方法 | 路径 | 访问要求 | 用途 | 实现 |
|---|---|---|---|---|
| GET | `/api/blog-admin/email-verification-status` | author/admin/super_admin | 邮箱验证状态兼容接口 | `pb_hooks/admin_webauthn.pb.js` |
| GET | `/api/blog-admin/step-up/status` | 管理员角色 | 查询 step-up 状态 | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/step-up/revoke` | 管理员角色 | 撤销 step-up 会话 | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/totp/setup` | super_admin + step-up | 创建 TOTP 配置 | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/totp/confirm` | super_admin + step-up | 确认 TOTP 绑定 | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/totp/verify` | admin/super_admin + 已绑定 TOTP | 验证 TOTP 并签发 step-up | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/totp/revoke` | super_admin + step-up | 吊销 TOTP | `pb_hooks/admin_security.pb.js` |
| POST | `/api/blog-admin/local-recovery` | super_admin + 已验证邮箱 | 本地恢复码恢复 | `pb_hooks/admin_security.pb.js` |
| GET | `/api/blog-admin/security/status` | admin/super_admin | 安全状态总览 | `pb_hooks/security_status.pb.js` |
| GET | `/api/blog-admin/security/events` | admin/super_admin | 安全事件查询 | `pb_hooks/security_status.pb.js` |

### 3.2 ESA 缓存管理

| 方法 | 路径 | 访问要求 | 用途 | 实现 |
|---|---|---|---|---|
| GET | `/api/blog-admin/esa/config` | super_admin + step-up | 读取 ESA 配置 | `pb_hooks/cache_admin.pb.js` |
| PUT | `/api/blog-admin/esa/config` | super_admin + step-up | 更新 ESA 配置 | `pb_hooks/cache_admin.pb.js` |
| POST | `/api/blog-admin/esa/purge` | super_admin + step-up | 提交 ESA 缓存刷新 | `pb_hooks/cache_admin.pb.js` |
| GET | `/api/blog-admin/esa/tasks` | super_admin + step-up | 查询 ESA 刷新任务 | `pb_hooks/cache_admin.pb.js` |

### 3.3 邮件治理

以下接口均要求 super_admin + step-up，由 `pb_hooks/mail_admin.pb.js` 实现。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/blog-admin/mail/overview` | 邮件治理总览 |
| GET | `/api/blog-admin/mail/queue` | 邮件队列 |
| GET | `/api/blog-admin/mail/logs` | 邮件日志 |
| GET | `/api/blog-admin/mail/templates` | 查询模板 |
| GET | `/api/blog-admin/mail/rules` | 查询发送规则 |
| GET | `/api/blog-admin/mail/suppress` | 查询抑制名单 |
| GET | `/api/blog-admin/mail/smtp` | 查询 SMTP 配置 |
| POST | `/api/blog-admin/mail/verify` | 验证 SMTP 配置 |
| POST | `/api/blog-admin/mail/test` | 发送测试邮件 |
| PUT | `/api/blog-admin/mail/smtp` | 更新 SMTP 配置 |
| PUT | `/api/blog-admin/mail/templates` | 更新邮件模板 |

### 3.4 安全策略

以下接口要求 super_admin + step-up + 可信管理 IP，由 `pb_hooks/security_policy_admin.pb.js` 实现。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/blog-admin/security/rate-policy` | 读取限流策略 |
| PUT | `/api/blog-admin/security/rate-policy` | 更新限流策略 |
| GET | `/api/blog-admin/security/registration-mode` | 读取注册模式 |
| PUT | `/api/blog-admin/security/registration-mode` | 更新注册模式 |

## 4. PocketBase 原生 REST

### 4.1 标准路径模式

| 操作 | 方法与路径 |
|---|---|
| List | `GET /api/collections/<name>/records` |
| View | `GET /api/collections/<name>/records/<id>` |
| Create | `POST /api/collections/<name>/records` |
| Update | `PATCH /api/collections/<name>/records/<id>` |
| Delete | `DELETE /api/collections/<name>/records/<id>` |
| 文件下载 | `GET /api/files/<name>/<recordId>/<filename>` |

### 4.2 Auth 集合端点

| 方法 | 路径 | 状态 |
|---|---|---|
| POST | `/api/collections/users/auth-with-password` | 公网；受登录限流 hook 保护 |
| POST | `/api/collections/users/auth-refresh` | 需要有效 refresh 上下文 |
| POST | `/api/collections/users/request-verification` | Caddy 暴露策略需同时核对；项目优先走自定义 blog-auth 接口 |
| POST | `/api/collections/users/confirm-verification` | 验证 token |
| POST | `/api/collections/users/request-password-reset` | Caddy 层拦截；项目走自定义接口 |
| POST | `/api/collections/users/confirm-password-reset` | 验证 token |
| POST | `/api/collections/users/request-email-change` | Caddy 暴露策略需同时核对 |
| POST | `/api/collections/users/confirm-email-change` | 验证 token |
| POST | `/api/collections/users/auth-with-oauth2` | 仅在启用 OAuth2 provider 时有效 |
| POST | `/api/collections/users/records` | 已关闭，`users.createRule = null` |

### 4.3 集合规则摘要

| 集合 | List / View | Create | Update | Delete |
|---|---|---|---|---|
| `users` | 本人或 admin | 关闭 | 本人或 super_admin | super_admin |
| `posts` | published；或 admin；或 author 自己的文章 | admin；或 author 且 author 字段为本人 | admin；或 author 自己的文章 | 同 Update |
| `comments` | 仅 staff；匿名读使用 `public_comments` 视图 | 仅针对 published 文章 | admin | admin |
| `comment_likes` | 关闭 | 关闭 | 关闭 | 关闭 |
| `tags` | 公开 | author 及以上 | author 及以上 | admin |
| `post_tags` | 公开 | admin；或 author 自己文章 | 同 Create | 同 Create |
| `settings` | 8 个白名单 key；或 super_admin | super_admin | super_admin | super_admin |
| `public_comments` | 公开，仅 approved 且未删除，字段裁剪 | 关闭 | 关闭 | 关闭 |

当前 settings 公共白名单：`site_title`、`site_description`、`site_logo`、`posts_per_page`、`enable_comments`、`comment_moderation`、`debug_protection_enabled`、`feature_flags`。

## 5. Astro SSR endpoint

| 方法 | 路径 | 访问要求 | 用途 | 实现 |
|---|---|---|---|---|
| GET | `/feed.xml` | 公网 | RSS 2.0 订阅源 | `astro/src/pages/feed.xml.ts` |

`astro/src/config/feature-flags.ts` 中存在默认关闭的 `/api/chat` 占位配置，但当前没有服务端实现或调用方，因此不计入有效 API。

## 6. 仅内部 API

### 6.1 PocketBase 邮件归档

以下 9 条接口由 `pb_hooks/mail_archive.pb.js` 提供，使用 HMAC + nonce；生产 Caddy 对 `/api/blog-internal/mail-archive/*` 直接返回 404，因此不对公网开放。

```text
POST /api/blog-internal/mail-archive/status
POST /api/blog-internal/mail-archive/prepare
POST /api/blog-internal/mail-archive/export
POST /api/blog-internal/mail-archive/seal
POST /api/blog-internal/mail-archive/uploaded
POST /api/blog-internal/mail-archive/commit
POST /api/blog-internal/mail-archive/restore-descriptor
POST /api/blog-internal/mail-archive/retention-due
POST /api/blog-internal/mail-archive/retention-confirm
```

### 6.2 admin-auth 内部服务

| 方法 | 路径 | 鉴权 | 用途 | 实现 |
|---|---|---|---|---|
| GET | `/health` | 无；IP 限流 | docker healthcheck | `admin-auth/src/server.mjs` |
| POST | `/internal/mail/send` | `X-Mail-*` HMAC + timestamp + nonce | 发送邮件 | `admin-auth/src/mail/http.mjs` |
| POST | `/internal/mail/verify` | 同上 | 验证 SMTP | `admin-auth/src/mail/http.mjs` |
| GET | `/internal/mail/status` | 同上 | 邮件服务状态 | `admin-auth/src/mail/http.mjs` |
| POST | `/internal/mail/geo/lookup` | 同上 | GeoIP 查询 | `admin-auth/src/mail/http.mjs` |
| POST | `/internal/session/verify` | `X-Internal-Secret` | 验证内部会话 | `admin-auth/src/server.mjs` |
| POST | `/internal/step-up/issue` | `X-Internal-Secret` | 签发 step-up 凭证 | `admin-auth/src/server.mjs` |
| POST | `/internal/step-up/verify` | `X-Internal-Secret` | 验证 step-up 凭证 | `admin-auth/src/server.mjs` |
| POST | `/internal/esa/purge` | `X-Mail-*` HMAC + timestamp + nonce | ESA 缓存刷新 | `admin-auth/src/esa/http.mjs` |
| POST | `/internal/esa/tasks` | 同上 | ESA 任务查询 | `admin-auth/src/esa/http.mjs` |

`/internal/esa/*` 已由 `createServer()` 在旧 `X-Internal-Secret` 分支之前分发给 `esaHttpHandler`，与 `/internal/mail/*` 使用相同的 HMAC 验签边界；回归测试位于 `admin-auth/test/server.test.mjs`。

## 7. Caddy 暴露边界

| 路径 | 处理方式 | 公网状态 |
|---|---|---|
| `/api/blog-auth/*`、`/api/comments/*`、`/api/search*`、`/api/track-view`、`/api/blog-stats`、`/api/friend-link-stats` | 反代 PocketBase | 可达；由 hook 鉴权/限流 |
| `/api/blog-admin/*` | 反代 PocketBase | 网络层可达；由 hook 鉴权 |
| `/api/collections/*` | 反代 PocketBase，部分敏感路径先被拦截 | 依赖 Caddy 路由与集合 rule |
| `/api/admins/*`、`/_/*` | 反代 PocketBase | 受 `ADMIN_IP` 白名单配置影响 |
| `/api/blog-internal/mail-archive/*` | 直接 404 | 不可达 |
| `admin-auth:8787` | compose 仅 `expose`，无 Caddy 路由 | 不可达，仅 docker 内网 |
| `/posts/*`、`/tags/*`、`/archive`、`/stats`、`/` | 反代 Astro SSR `10.255.0.1:4321` | 可达 |

生产 `docker-compose.yml` 当前为 `ADMIN_IP=${ADMIN_IP:-0.0.0.0/0}`，默认值等价于关闭 Caddy IP 白名单；生产安全依赖部署环境覆盖该变量或由外层 ESA / SafeLine 提供等效限制。

## 8. 非 HTTP 钩子

以下属于 PocketBase 生命周期或定时任务，不是 HTTP API：

- `onMailerBeforeRecordVerificationSend`、`onMailerBeforeRecordResetPasswordSend`、`onMailerBeforeRecordChangeEmailSend`
- `onRecordBeforeAuthWithPasswordRequest`、`onRecordAfterAuthWithPasswordRequest`
- 评论、留言、角色守卫、审计、通知等 record create/update/delete hooks
- `cronAdd` 注册的 OTP 清理、邮件出站、定时发布、限流桶清理、统计留存、账号保留、邮件归档任务
- `onBeforeApiError` 错误码归一化

## 9. 验证状态与待确认项

本地隔离环境全量验证（2026-08-22，PocketBase 0.22.21 隔离实例 + Mailpit 1.30.0，未触生产）：

- `scripts/test-api-surface-local.ps1 -Offline`：65/65。公开健康/搜索/统计/track-view、评论四动作负路径、OTP/注册/密码重置统一响应、全部 `/api/blog-admin/*` 匿名门禁 401/403、未知管理路由 404、9 条 `/api/blog-internal/mail-archive/*` 未签名 401（ARCHIVE_AUTH_REJECTED）、原生 REST 规则抽查（posts/comments/public_comments/comment_likes/tags/settings/users）。
- `scripts/test-security-rate-local.ps1 -All -Offline`：8/8（policy、rate 含并发与重启持久化、account_mail、registration、outbox、admin_policy）。
- `scripts/test-stats-friend-local.ps1 -Offline`：PASS（track-view 哈希身份、可信 IP、referrer 白名单、friend-link-stats、Top10）。
- `scripts/test-gallery-local.ps1 -Offline`：PASS（gallery REST + step-up 边界 + 审计）。
- `scripts/test-mail-gateway-local.ps1`：Mailpit 集成 2/2 + admin-auth 逐文件回归全绿；唯一例外 `mail/cli.test.mjs` 两个用例需 spawn 子进程，本机 Windows 沙箱 EPERM 不可运行（环境限制，非代码缺陷）。
- 静态回归：`tests/security-rate/search_api_injection.test.js`、`comment_like_dedup.test.js`、`hook_log_safety.test.js` 均 PASS。

本轮修复的缺陷：admin-auth ESA 路由接管缺失；限流策略迁移缺口（新增 `20260821120000_add_comment_action_rate_policies.pb.js`）；TOTP 第 5 次失败才锁定的 off-by-one；pb_hooks 五处 JSVM API 误用（详见 git 变更：comment_actions_lib/comment_verification/security_policy_admin/cache_admin/stats_lib/login_security_lib）。

仍需部署环境或本地 PocketBase/Caddy 联调：

1. 逐条验证公网 Caddy 路由与 hook 鉴权行为（本机无 Docker，未覆盖 Caddy 层）。
2. 确认生产 `ADMIN_IP` 或外层 ESA/SafeLine 对 `/_/*`、`/api/admins/*` 的限制。
3. `/feed.xml`（Astro SSR endpoint）未做动态验证，需构建环境。
4. 确认无前端调用的 health、suggest、local-recovery、email-verification-status 是否为监控或兼容接口。
5. 检查 `docker-compose.local.yml` 的 PocketBase healthcheck URL 是否存在拼接错误。
6. `scripts/test-admin-step-up.ps1` 与 `tests/admin-security/step_up_fixture.pb.js` 仍针对已移除的 Passkey API，属过期资产，需按 TOTP 重写或删除。
