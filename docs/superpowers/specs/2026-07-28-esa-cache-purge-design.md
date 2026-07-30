# ESA 缓存刷新管理 — 设计文档

- 日期：2026-07-28
- 状态：待评审
- 关联事故：2026-07-28 ESA 边缘缓存 HTML 47 小时导致 /stats/ 等页面 React 岛屿 404 空白

## 1. 背景与目标

阿里云 ESA 边缘节点无视源站 `no-store` 长期缓存 HTML，每次部署后旧 HTML 引用已删除的 hash chunks，导致页面组件空白。目前只能登录阿里云控制台手动刷新缓存。

目标：在博客后台提供独立的「缓存管理」页，超级管理员可一键刷新 ESA 边缘缓存（全站 / 自定义路径），并管理 ESA API 凭证。

## 2. 已确认需求

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | API | 阿里云 ESA OpenAPI `PurgeCaches`（版本 2024-09-10），配套 `DescribePurgeTasks` 查询状态 |
| 2 | 刷新粒度 | 全站刷新（purgeall）+ 自定义路径刷新（file/directory，多行 URL 输入） |
| 3 | 凭证管理 | 后台手动添加，加密保存（不落明文，可脱敏回显） |
| 4 | 操作权限 | **仅 super_admin**；前端二次确认（全站刷新红色危险确认）；后端限频 |
| 5 | 入口位置 | 独立「缓存管理」页（侧栏新增项） |
| 6 | 可见性 | 普通用户/author/admin 不可见入口；前端过滤 + 后端强制双保险 |
| 7 | 调用链路 | 方案 B：PB hook → admin-auth 微服务（内网）→ ESA API |

## 3. 架构

```
浏览器（缓存管理页，super_admin）
  │  X-Admin-Session + X-Admin-Step-Up
  ▼
PocketBase  /api/blog-admin/esa/*  (cache_admin.pb.js)
  │  requireAdminStepUp({requireSuperAdmin:true}) + 限频 + 审计
  │  解密凭证 → HMAC 签名内网请求
  ▼
admin-auth  /internal/esa/*  (esa-client.mjs)
  │  阿里云 RPC 签名（HMAC-SHA1）
  ▼
esa.cn-hangzhou.aliyuncs.com  PurgeCaches / DescribePurgeTasks
```

选型理由：PB JSVM `$security` 仅提供 HMAC-SHA256，而阿里云 RPC 签名需要 HMAC-SHA1；admin-auth 为 Node 运行时，crypto 原生支持，且复用 mail_gateway 已有的内网 HMAC sign/verify 设施，与邮件平台架构一致。

## 4. 数据层

### 4.1 迁移文件

`pb_migrations/20260728120000_create_esa_purge_collections.pb.js`（遵循迁移规范：`getFieldByName()` + `addField(new SchemaField())`，禁用原生数组方法）。

### 4.2 `esa_purge_settings`（单条凭证配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| access_key_id | text | AccessKey ID（明文即可，非高敏） |
| access_key_secret_enc | text | `admin_totp.js` encryptSecret 加密后的 Secret |
| site_id | number | ESA 站点 ID |
| enabled | bool | 是否启用 |
| updated_by | text | 最后操作人 user id |

- 集合无任何 API 规则（仅 hook 内访问），同 `mail_smtp_settings` 模式
- 单条记录语义：读取第一条；保存时 upsert

### 4.3 `esa_purge_tasks`（刷新记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| task_id | text | ESA 返回的 TaskId（失败时为本地 request id） |
| type | text | `purgeall` / `file` / `directory` |
| content | json | 提交的 URL 列表（purgeall 为空数组） |
| status | text | `submitted` / `complete` / `failed` / `rejected` |
| message | text | 错误信息或 ESA 返回摘要 |
| created_by | text | 操作人 user id |

- 集合无任何 API 规则（仅 hook 内访问）
- 状态同步：tasks 列表接口按需调用 `DescribePurgeTasks` 刷新最近记录状态

## 5. 后端 — PocketBase hooks

### 5.1 `pb_hooks/cache_admin.pb.js`（薄路由）

遵循 handler 内 require 的 JSVM 模式：

```
GET  /api/blog-admin/esa/config   → lib/cache_admin.js.configRead
PUT  /api/blog-admin/esa/config   → lib/cache_admin.js.configSave
POST /api/blog-admin/esa/purge    → lib/cache_admin.js.purge
GET  /api/blog-admin/esa/tasks    → lib/cache_admin.js.tasks
```

### 5.2 `pb_hooks/lib/cache_esa_config.js`（凭证加解密读写）

复刻 `mail_smtp_config.js` 模式：
- `resolve(dao)` → 解密后的完整凭证（未配置/未启用返回 null）
- `readPublic(dao)` → 脱敏视图：`{configured, enabled, access_key_id 掩码, site_id, has_secret, updated_at}`
- `save(dao, input, userId)` → 校验 + 加密 upsert；secret 留空且已有记录时保留原 secret

校验规则：access_key_id 长度 ≤ 128；site_id 为正整数；secret 长度 ≤ 512。

### 5.3 `pb_hooks/lib/cache_admin.js`（业务逻辑）

所有端点统一前置：
```js
var secure = stepUp.requireAdminStepUp(c, {
  requireSuperAdmin: true,
  requireVerifiedEmail: true,
});
```

- **configRead**：返回 `readPublic` 脱敏视图
- **configSave**：写库 + 审计日志（`audit_logs`，action `esa_config_save`）
- **purge**：
  - 入参 `{type: 'purgeall'}` 或 `{type: 'auto', urls: [...]}`
  - URL 规范化与校验：仅允许 `https://hlydwz.com` 域（防止误刷他站/凭证外泄滥用）；以 `/` 结尾且无文件扩展名的归为 directory，其余为 file；每类 ≤ 100 条
  - 限频：复用 `security_rate_limit` 持久化桶，每用户每小时 ≤ 10 次 purge
  - 解密凭证 → 调 admin-auth `/internal/esa/purge`（HMAC 签名，复用 `mail_gateway.js` 的 sign）
  - 写 `esa_purge_tasks`（成功 submitted / 失败 rejected）+ 审计日志（action `esa_purge`，含 type 与条数）
  - 返回 `{ok, task_id, status}`
- **tasks**：本地记录倒序 20 条；对 status=submitted 的记录调 admin-auth `/internal/esa/tasks`（DescribePurgeTasks）同步状态

### 5.4 未配置降级

凭证未配置或未启用时：config 接口正常返回 `configured:false`；purge 接口返回 503 `ESA_NOT_CONFIGURED`，前端显示配置引导。

## 6. 内网服务 — admin-auth

### 6.1 `admin-auth/src/esa-client.mjs`

- 阿里云 RPC 签名（HMAC-SHA1）：
  - 公共参数：`Format=JSON, Version=2024-09-10, AccessKeyId, SignatureMethod=HMAC-SHA1, Timestamp(ISO8601 UTC), SignatureNonce, SignatureVersion=1.0`
  - `StringToSign = POST&%2F&` + 按 key 排序并 percentEncode 的查询串
  - `Signature = Base64(HMAC-SHA1(StringToSign, AccessKeySecret + "&"))`
- `purgeCaches({siteId, type, content})` → POST `https://esa.cn-hangzhou.aliyuncs.com/`，Action=PurgeCaches
  - purgeall：`Type=purgeall&Content={"PurgeAll":true}`
  - file：`Type=file&Content={"Files":[...]}`
  - directory：`Type=directory&Content={"Directories":[...],"Force":true}`
- `describePurgeTasks({siteId, taskId})` → Action=DescribePurgeTasks
- 超时 10s；错误时提取 `Code`/`Message` 上抛，不回传 AccessKey 相关字段

### 6.2 路由 `admin-auth/src/server.mjs` 新增

```
POST /internal/esa/purge   → 验签（复用 mail/request-auth.mjs）→ esa-client.purgeCaches
POST /internal/esa/tasks   → 验签 → esa-client.describePurgeTasks
```

- 内网验签复用现有 `MAIL_INTERNAL_SECRET` HMAC 方案（时间戳 + nonce + 方法 + 路径 + body sha256）
- 请求体含完整凭证（与 SMTP override 同模式，凭证不出容器内网）
- 自带 IP 限频沿用 server 现有 30 次/分

### 6.3 单元测试

`admin-auth/test/esa-client.test.mjs`：签名确定性测试（固定 nonce/timestamp 断言 signature）、参数构造（三种 type）、错误映射。不依赖真实阿里云调用。

## 7. 前端

### 7.1 分层（遵循 service → domain hook → 组件）

| 层 | 文件 | 职责 |
|----|------|------|
| service | `astro/src/lib/services/cacheService.ts` | 4 个端点调用，类型定义 |
| domain hook | `astro/src/hooks/domains/useCacheManager.ts` | 配置状态、刷新提交、记录列表、加载/错误状态 |
| 组件 | `astro/src/components/admin/cache/CacheManager.tsx` | UI 与交互 |
| 页面 | `astro/src/pages/admin/cache.astro` | 薄壳挂载 |

### 7.2 CacheManager 三个区块

1. **凭证配置卡**：脱敏回显 + 编辑表单（AccessKey ID / Secret 密码框 / Site ID / 启用开关）；Secret 留空表示不修改；保存成功 Toast
2. **刷新操作卡**：
   - 「全站刷新」危险色按钮 → `ConfirmDialog`（红色，文案明确"将使全站缓存回源，可能短时增加源站压力"）
   - 「自定义路径刷新」：textarea 多行 URL → 前端预校验（仅 hlydwz.com 域、每行一条、自动归类 file/directory 预览）→ 普通确认弹窗
3. **刷新记录表**：时间 / 类型 / 条数 / TaskId / 状态（submitted→complete 轮询一次同步）/ 失败信息

### 7.3 可见性控制（三层）

1. `AdminSidebar` 新增项 `{ href: '/admin/cache', label: '缓存管理', section: '系统', requiredRole: 'super_admin', hint: 'ESA' }` —— 侧栏按角色过滤，非超管不渲染
2. 页面内 `AdminGuard` 校验 + `hasPermission('super_admin')` 不通过时渲染无权限提示（而非组件本体）
3. 后端每个端点 `requireSuperAdmin` 强制 403

## 8. 安全清单

- [ ] 凭证集合无 API 规则，Secret 仅加密落库，任何接口不回传明文 Secret
- [ ] 内网请求 HMAC 签名（时间戳 ±300s 窗口 + nonce）
- [ ] purge URL 白名单限定 `https://hlydwz.com`，防凭证被滥用于他站
- [ ] 限频：每用户每小时 ≤ 10 次 purge；端点本身 requireSuperAdmin + verified email
- [ ] 审计：config 保存与每次 purge 均写 `audit_logs`（不含 Secret）
- [ ] 日志脱敏：错误信息仅记录 Code，不记录请求体
- [ ] Caddy 层：`/api/blog-admin/*` 已有 noindex + no-store + CORS 限定，无需变更

## 9. 错误处理

| 场景 | 行为 |
|------|------|
| 未配置凭证 | purge 返回 503 `ESA_NOT_CONFIGURED`，前端引导配置 |
| ESA 返回 QuotaExceeded | 记录 rejected + message，前端提示"超出当日配额" |
| ESA 返回 TooManyRequests | 同上，提示稍后重试 |
| admin-auth 不可达 | 记录 rejected，前端提示服务不可用 |
| 非法 URL（非本站域/格式错误） | 400 `INVALID_PURGE_URL`，前端逐行标红 |
| 限频触发 | 429，前端提示频率限制 |

## 10. 测试计划

1. **admin-auth 单测**：`test/esa-client.test.mjs`（签名、参数构造、错误映射）
2. **本地集成**：`scripts/test-esa-purge-local.ps1` —— 起本地栈，种 super_admin fixture，验证：非超管 403 / 未配置 503 / 配置保存与脱敏回显 / purge 链路（admin-auth 侧打桩 ESA 端点）/ 限频 429
3. **真实联调**（部署后）：配置真实凭证 → 自定义路径刷新单页面 → ESA 控制台核对任务 → 全站刷新 → 验证 Age 头归零

## 11. 部署与配置

1. 应用迁移：`esa_purge_settings` + `esa_purge_tasks`
2. 重建 admin-auth 镜像（新增 esa-client）
3. 无需新增环境变量（复用 `MAIL_INTERNAL_SECRET` 做内网验签）
4. 后台「缓存管理」页录入 AccessKey（RAM 子账号，仅授权 `esa:PurgeCaches` + `esa:DescribePurgeTasks`）与 SiteId

## 12. 不做的事（YAGNI）

- 不做 cachetag/cachekey/ignoreparams/hostname 刷新类型（本站无对应配置）
- 不做定时自动刷新（部署后自动刷新属后续迭代，可由部署脚本调 purge 端点实现）
- 不做预热（Preload）
- 不做配额查询接口
