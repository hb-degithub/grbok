# 邮件安全、精确限流与加密归档设计

日期：2026-07-15

状态：设计已由用户逐节确认，等待书面规格复核

适用范围：PocketBase 0.22.21、Astro 管理后台、OpenResty、Caddy、`admin-auth` 邮件网关、1Panel 宿主机任务

## 1. 背景

本设计修复安全审核中的五项问题，并补齐自动注册、邮件旁路、长期日志和后台配置风险：

1. 管理写操作可复用同一账号其他浏览器或设备的 Passkey step-up。
2. 已有 Passkey 的 Super Admin 可仅凭一阶 token 注册新凭据。
3. `admin_passkeys` 缺少统一 step-up、服务端专用 API 和应用审计。
4. Caddy 使用 `{remote_host}` 覆盖真实客户端 IP，导致共享网络或代理地址进入同一限流桶。
5. 超限账户邮件持续写入 `mail_delivery_logs`，可形成写盘放大。
6. 注册限流位于进程内，PocketBase 重启后清零。
7. 注册自动验证邮件、评论直发 SMTP、原生账户邮件 API、管理员测试与内部网关可能绕过统一策略。
8. 在线日志没有满足数据最小化、加密离线保存和确定删除的完整生命周期。

## 2. 目标

- 修复全部已确认安全问题。
- 对敏感账户邮件执行精确滚动窗口：邮箱 `2 次/15 分钟`、IP `5 次/15 分钟`、全局 `30 次/分钟`。
- 让严格配额可由后台在硬安全边界内调整，但不能关闭基础保护。
- 阻止通过注册、原生 API、评论通知或管理员测试绕过邮件保护。
- 防止 PocketBase 重启、并发请求或 IPv6 地址轮换绕过注册限制。
- 公开接口避免账户枚举，同时为用户和管理员提供稳定错误码、`referenceId` 和文档入口。
- 在线投递日志正常保留 7 天；超过 7 天后生成最小化、`age` 加密的审计归档并通过 `rclone` 自动同步。
- 未验证且无业务关系的账户保留 60 天，删除前提醒一次。
- 不向数据库、API、前端、Git、日志或云端归档暴露 SMTP 凭据、原始邮箱、原始 IP、token、OTP 或正文。

## 3. 非目标

- 不承诺仅靠 IP 限流完全阻止分布式低速 botnet；系统提供监控与人工切换邀请码模式的应急能力。
- 不把 SMTP 主机、用户名、密码、`MAIL_INTERNAL_SECRET`、`MAIL_HASH_SECRET`、`MAIL_ARCHIVE_HMAC_SECRET`、rclone 凭据或 age 私钥放入后台配置。
- 不把审计归档当作 PocketBase 完整灾难恢复备份。
- 不直接读取、复制或修改运行中的 `data.db`、WAL 或 SQLite free pages。
- 不在本任务中部署生产、发送真实 SMTP 邮件或配置真实云盘凭据。

## 4. 总体方案

采用本地分层防护：

1. OpenResty 负责可信客户端 IP 规范化和短时洪泛保护。
2. Caddy 只信任 OpenResty，向 PocketBase 传递 `{client_ip}`。
3. PocketBase 使用私有 SQLite 精确滚动桶执行持久、原子、可审计的严格配额。
4. 所有账户邮件、注册自动验证、评论通知和管理员测试进入统一邮件网关；不同用途使用隔离的 policy。
5. 管理安全写操作使用独立、浏览器会话绑定的 Passkey step-up。
6. 宿主机归档脚本通过受签名内部 API 导出审计摘要，经 gzip、age、rclone 和远端校验后提交删除。

默认保持公开注册，但关闭 PocketBase 原生匿名 create，所有注册通过专用 facade。后台提供人工切换邀请码模式的紧急开关；切换必须由 Super Admin 在可信管理 IP 上完成 Passkey step-up，不允许攻击流量自动关闭全站注册。

## 5. 管理员 Passkey 与 step-up

### 5.1 凭据格式与存储

WebAuthn step-up 成功后返回：

```text
X-Admin-Step-Up: v1.<selector>.<secret>
```

- `selector` 和 `secret` 均由加密安全随机数生成器产生。
- 数据库只保存带命名空间的 secret HMAC，不保存原始 secret。
- 原始 step-up 只返回一次，只保存到当前标签页的 `sessionStorage`。
- 浏览器生成 32 字节 `X-Admin-Session` 并保存到 `sessionStorage`。
- PocketBase 单例请求钩子只向同源 PocketBase API 添加 `X-Admin-Step-Up`、`X-Admin-Session` 和 `X-Browser-Fingerprint`。
- Caddy、OpenResty、PocketBase 和浏览器诊断日志禁止记录三个 header 的值。

### 5.2 服务端验证

每次安全写操作必须同时验证：

- 当前 PocketBase auth user；
- header 中指定的唯一 selector；
- secret HMAC，使用常量时间比较；
- client-session HMAC；
- 浏览器指纹；
- 可信真实 IP；
- User-Agent；
- 到期时间和 `revoked_at`。

禁止退回到“仅按 userId 查询任意未过期会话”。重新通过 Passkey 后，撤销同一 user 和 client-session 的旧 step-up，避免一个标签页累积多个有效凭据。登出、用户切换、到期、撤销或绑定变化后立即失效。

### 5.3 受控首次注册

- 私有 `admin_passkey_state` 保存 `bootstrapped_at`，客户端不可读写原始记录。
- 首次 bootstrap 同时要求：已验证邮箱、`super_admin`、可信 `ADMIN_IP`、从未完成 bootstrap。
- options 与 verify 两阶段都重新校验条件。
- verify 在同一事务中重新检查状态、创建 Passkey、写入 `bootstrapped_at`，防止并发双注册和 TOCTOU。
- 迁移时，只要管理员历史上存在任意 Passkey，就回填为已 bootstrap。
- 已 bootstrap 的管理员即使有效 Passkey 数为零，也不能再次走首次注册。
- 新增 Passkey 的 challenge 绑定当前 step-up selector 和 client-session；verify 时再次验证。
- 远程 API 禁止撤销或删除最后一枚有效 Passkey。
- 全部凭据丢失时只能通过宿主机恢复命令处理；恢复必须撤销该管理员全部 step-up 并写入高优先级审计。

### 5.4 API 与审计

- `admin_passkeys` 禁止客户端直接 list/create/update/delete。
- 所有 Passkey 管理改为 `/api/blog-admin/*` 专用 API。
- 所有后台安全写操作同时要求 `super_admin`、已验证邮箱、可信管理 IP 和当前 step-up。
- 审计保存 actor、稳定动作码、before/after 的脱敏结构、版本号、随机 `referenceId` 和时间；不保存凭据、完整邮箱或 header。
- 部署迁移后撤销全部旧 `admin_verified_sessions`，管理员必须重新验证。

## 6. SQLite 精确滚动限流

### 6.1 数据模型

#### `security_rate_policies`

私有、server-only 集合。字段包括：

- `key`：固定 policy 枚举；
- `limit`：允许事件数；
- `window_seconds`：精确窗口；
- `version`：CAS 版本；
- `updated_by`、`updated_at`：脱敏审计关联。

不得接受自定义 key 表达式、动态 SQL 或客户端直接 collection PATCH。

#### `security_rate_buckets`

- `policy`：固定枚举；
- `subject_hash`：带 policy 命名空间的 HMAC；
- `events_json`：升序整数毫秒时间戳数组；
- `expires_at`：清理提示时间。

唯一索引：`(policy, subject_hash)`。

清理索引：`(expires_at)`。
`events_json` 硬限制为最多 300 个整数和 16 KiB。非法 JSON、非整数、乱序、异常未来时间或超限大小均 fail-closed 并告警。

### 6.2 精确滚动算法

一次业务请求使用同一个服务端 `now`，在一个 PocketBase/SQLite 事务中：

1. 规范化 subject。
2. 读取并裁剪每个相关桶中 `timestamp > now - window` 的事件。
3. 先检查全部桶；任意桶已满则拒绝业务动作，所有桶都不追加。
4. 全部可用才向所有桶追加同一个 `now` 并原子 upsert。
5. 事务失败、SQLite busy、唯一冲突未能重试或桶损坏时 fail-closed。

超限请求不追加事件、不延长桶寿命、不创建逐请求投递日志、不创建 OTP challenge。小时清理任务按 500 条分页删除 `expires_at < now` 的桶；正确性不依赖清理任务，读取时始终裁剪。

邮箱仅执行 `trim + lowercase`，不应用 Gmail 点号或 plus alias 规则。IPv4/IPv6 使用标准化文本；注册另外派生 IPv6 `/64` subject。

### 6.3 默认策略与后台边界

| 策略 | 默认值 | 后台允许范围 |
| --- | ---: | ---: |
| 账户邮件：邮箱 | 2 次/15 分钟 | 1–5 次，5–60 分钟 |
| 账户邮件：IP | 5 次/15 分钟 | 2–20 次，5–60 分钟 |
| 账户邮件：全局 | 30 次/分钟 | 10–120 次，1–15 分钟 |
| 注册：IP | 3 次/小时 | 1–10 次/小时 |
| 注册：IPv6 `/64` | 10 次/小时 | 2–30 次/小时 |
| 注册：全局 | 20 次/分钟 | 5–60 次/分钟 |
| 管理员测试：每管理员 | 3 次/小时 | 固定 |
| 管理员测试：全局 | 10 次/天 | 固定 |

- 邮箱、IP、全局三层账户邮件保护均不可关闭。
- 后台保存整组策略，使用 version/CAS；旧版本返回 `409 POLICY_VERSION_CONFLICT`。
- 修改立即影响新请求，但不清空或重写既有桶。
- 配置缺失、损坏或越界时回退到严格默认值，不放宽。
- 环境总开关是上限；后台只能进一步关闭功能，不能越过环境禁用状态重新启用。
- 不提供远程“清空全部桶”接口。

### 6.4 Policy 隔离

账户邮件四入口共用三层额度：密码重置、验证重发、换邮箱、Reader OTP。注册后的首次验证邮件也消费相同额度。

评论通知、管理员测试、账户保留提醒、运维告警和可选的全部出站 provider 保护使用独立 policy，防止攻击者耗尽公开账户邮件全局桶后阻断运维告警。运维告警按状态去重：首次故障一封、持续故障最多每 30 分钟一封、恢复一封。

## 7. 注册防滥用与账户生命周期

### 7.1 注册 facade

- 关闭 `users` 原生匿名 createRule。
- 所有前端注册、欢迎引导和 API 客户端必须调用专用 `/api/blog-auth/register`。
- 注册前先消费 IP、IPv6 `/64` 和注册全局桶；限流存储不可用时不创建账户。
- 字段校验失败不消费邮箱桶，防止攻击者用无效载荷锁死受害者地址。
- 注册成功后的验证邮件再原子消费账户邮件邮箱/IP/全局桶；额度不足时保留账户但不发送，用户以后从统一重发入口重试。
- PocketBase 重启或单进程替换不重置额度。
- 后台支持人工切换邀请码模式，修改要求 step-up、可信管理 IP、CAS 和审计。

### 7.2 未验证账户保留

私有 `account_retention_state` 保存：

- `user_id`；
- `cleanup_eligible_at`；
- `reminder_sent_at`；
- `reminder_attempts`；
- `last_error_class`。

规则：

- 注册后第 45 天，若仍未验证且没有评论、收藏或其他业务关系，发送一次“15 天后清理”提醒。
- 每账户最多一封成功提醒；临时失败在 72 小时内最多重试 3 次。
- 第 60 天再次事务检查；只有仍未验证且无任何业务关系才删除。
- 用户完成验证后立即取消清理。
- 已验证账户或存在业务关系的账户永不自动删除。
- 删除用户时同步删除 lifecycle state。
- 迁移既有账户时，清理时间为 `max(created + 60 天, 部署时间 + 15 天)`，避免上线即删。

提醒使用独立 `account_retention_notice` policy，并受全局出站保护，避免攻击者利用注册制造提醒群发。

## 8. 邮件入口收口

- 密码重置、验证重发、换邮箱、Reader OTP 使用账户邮件 facade。
- 注册自动验证邮件与手动重发共享账户邮件额度。
- 评论 Hook 禁止直接调用 `$app.newMailClient()` 或 `MailerMessage`；只创建 Outbox，由统一网关发送。
- 管理员测试收件人只能是服务器 allowlist 或当前已验证管理员邮箱。
- 原生 PocketBase request-password-reset、request-verification 和 request-email-change 对公网关闭。
- 必要的 PocketBase 内部 token 流程只能由 facade 通过服务端内部标记/HMAC 调用。
- `/internal/mail/send` 只在内部网络暴露，继续验证 HMAC、时间窗、nonce 和请求体哈希。
- PocketBase 8090 不得发布到公网或宿主机公共接口。

## 9. 真实客户端 IP 链

### 9.1 OpenResty

- 作为唯一公网可信入口，先覆盖客户端传入的 `X-Forwarded-For` 和 `X-Real-IP`。
- 无 CDN 时将两者设置为规范化后的 `$remote_addr`，不使用未经清洗的 `$proxy_add_x_forwarded_for`。
- 有 CDN 时只信任该 CDN 官方精确 CIDR，并配置正确的 real IP header；非可信来源携带的 CDN header 必须忽略。
- 账户邮件入口使用短时洪泛保护，例如 `1r/s burst=2`；注册使用约 `3r/m burst=2`。精确 15 分钟和 1 小时语义仍由 SQLite 完成。

### 9.2 Caddy

- 只信任 OpenResty 实际连接 IP/CIDR，不无条件信任全部 private ranges。
- `client_ip_headers` 使用 `X-Forwarded-For X-Real-IP`，条件允许时启用 strict。
- 反向代理 PocketBase 时使用 `{client_ip}` 写入上游 header，禁止 `{remote_host}`。

### 9.3 PocketBase

- 业务代码只读取 `e.realIP()`。
- 生产环境禁止回退到客户端可伪造的任意 header。
- 无法取得可信 IP 时：账户邮件 fail-closed 并返回统一公开响应；注册返回 `503` 且不创建账户。

## 10. 响应语义、错误码与参考编号

`referenceId` 为加密安全随机 128-bit 标识，不编码用户、邮箱、IP 或时间。它可与在线随机事件 ID 对应，用于支持定位。

### 10.1 公开账户邮件与 OTP

- `400 INVALID_REQUEST`：格式、字段长度、体积或内容非法。
- `202 MAIL_REQUEST_ACCEPTED`：合法请求，不论账户不存在、不符合资格、应用配额超限、功能关闭、桶故障或 SMTP 失败。
- OTP 返回随机 fake challengeId；只有“桶允许且 eligible reader”才持久化真实 challenge。
- 合法公开路径保持相同响应结构、字节形态和最低约 350ms 响应时间。
- OpenResty 对明显短时洪泛可返回通用 `429 REQUEST_RATE_LIMITED` 和 `Retry-After`；该判断仅基于 IP，不暴露账户状态。

### 10.2 已登录用户

身份已经确认的邮件操作可返回：

- `429 EMAIL_RATE_LIMITED`；
- `429 IP_RATE_LIMITED`；
- `429 GLOBAL_RATE_LIMITED`。

响应包含 `retryAfter`、`referenceId` 和错误码文档路径，但不返回精确计数、其他用户数据或全站流量详情。

### 10.3 注册

- `400 INVALID_REGISTRATION`：输入本身非法。
- `202 REGISTRATION_SUBMITTED`：语义合法的提交，包括重复 identity 的公开情况。
- `429 REGISTRATION_RATE_LIMITED`：持久注册配额耗尽。
- `503 REGISTRATION_UNAVAILABLE`：限流存储或可信 IP 不可用；不创建账户。

### 10.4 管理后台

- `401 AUTH_REQUIRED`
- `403 ADMIN_STEP_UP_REQUIRED`
- `403 ADMIN_NETWORK_DENIED`
- `409 POLICY_VERSION_CONFLICT`
- `422 POLICY_OUT_OF_SAFE_RANGE`
- `429 ADMIN_OPERATION_RATE_LIMITED`
- `503 MAIL_SERVICE_UNAVAILABLE`

签名、hash 或绑定字段不匹配时不返回具体哪一项错误，避免帮助攻击者探测凭据结构。错误码文档说明用户可采取的动作，但不披露内部实现和安全阈值之外的信息。

## 11. 投递日志与故障策略

- `mail_delivery_logs` 只记录真实出站尝试的结果，不记录超限、decoy、未知账户或未发送请求。
- 日志只保存随机事件 ID、固定 category、固定 result、耗时、尝试次数和稳定 error class。
- 不保存正文、主题、payload、token、OTP、SMTP 原文、完整异常堆栈或凭据。
- 邮件限流器故障：不发邮件；公开接口仍返回统一 `202`。
- 注册限流器故障：不创建账户，返回 `503`。
- SMTP 失败：公开接口不暴露 provider 详情，内部只记录稳定错误类别。
- 采样或聚合内部错误，避免错误日志成为新的写盘 DoS。

## 12. 加密归档

### 12.1 数据模型

`mail_archive_batches` 为私有集合，字段包括：

- `batch_id`；
- `status`：`prepared`、`sealed`、`uploaded`、`committed`；
- 游标和行数；
- plaintext、gzip、cipher SHA-256；
- cipher 大小；
- age recipient 指纹；
- 远端 object key；
- 各阶段时间和稳定错误类别。

`mail_delivery_logs` 增加 `archive_batch_id` 和 `created` 索引。批次预留、commit 和日志删除必须由 PocketBase 事务完成。

### 12.2 宿主机流程

1. 1Panel 每小时运行仓库提供的幂等归档脚本。
2. 脚本使用独立 `MAIL_ARCHIVE_HMAC_SECRET` 调用 prepare/export/commit 内部 API。
3. 请求签名包含时间戳、随机 nonce、请求体哈希和 HMAC；服务端限制时间偏差并拒绝 replay。
4. 每批最多 5000 行，按稳定 batch ID 导出规范 JSONL。
5. JSONL 写入 root/SYSTEM 专属目录，gzip 后使用固定 age recipient 公钥加密。
6. age 成功后立即删除明文 JSONL 和未加密 gzip；age 失败也清理明文并保留 DB 批次。
7. 使用低权限 rclone 账户上传密文，回读并验证 SHA-256；后端不支持 hash 时使用 `rclone cat` 回读本地计算。
8. 上传最小 manifest，并将远端值与数据库 sealed batch 的可信 hash 比较。
9. 全部匹配后调用幂等 commit；只有 committed 事务可以删除该批日志。
10. 本地密文在 commit 后 24 小时内删除。

禁止直接读取运行中的 `data.db`。单实例锁与事务预留防止两个任务交叉处理。同名远端对象 hash 不一致时停止并告警，不覆盖。

### 12.3 归档字段白名单

每行只允许：

- `schema_version`
- 随机 `event_id`
- UTC `created_at`
- 固定枚举 `category`
- 固定枚举 `source_kind`
- 固定枚举 `result`
- `duration_ms`
- `attempt`
- 固定枚举 `error_class`

未知字段必须拒绝，不得透传。明确排除邮箱、掩码邮箱、邮箱/IP hash、原始 IP、业务记录 ID、正文、主题、payload、token、OTP、SMTP 原始响应、UA、主机名、分类统计和自由文本。

manifest 可明文，但只允许：

- `schema_version`
- `batch_id`
- `min_created_at`、`max_created_at`
- `row_count`
- `plaintext_sha256`、`gzip_sha256`、`cipher_sha256`
- `cipher_size`
- `age_recipient_fingerprint`
- `object_key`
- `sealed_at`

远端对象名只使用年月和随机 batch ID，不包含邮箱、类别或分钟级业务时间。

### 12.4 保留与密钥

- 在线日志正常目标保留 7×24 小时，严格按 UTC `created < now - 7d` 入批。
- 归档故障时旧日志继续留库并告警，不为满足 7 天目标而直接删除。
- 云端密文和 manifest 从事件 `created_at` 起保留 90 天；到期删除对象、版本历史和回收站副本并验证不存在。
- committed batch 元数据最多保留 90 天；未完成批次不自动删除。
- age 私钥离线保存两份；服务器只保存 recipient 公钥和预期指纹。
- 公钥轮换期间同时加密给新旧 recipient；旧私钥必须保留到旧批次全部过期。
- rclone config 仅专用低权限账户可读，限制到单独 remote/prefix，不进入容器、Git、Compose 参数或命令输出。
- 每月在隔离环境执行解密、hash、gzip 完整性、JSONL schema 和行数恢复演练；恢复明文不得进入同步目录。

连续失败导致在线最老日志超过 8 天、工作目录达到容量阈值或 sealed/uploaded 超过 24 小时未 commit 时触发运维告警。

### 12.5 隐私与合规控制

- 在运维文档中登记处理目的、数据类别、在线 7 天和云端 90 天保留期、可访问角色、远端服务商、存储区域及可能的跨境位置。
- 启用远端前确认服务商的数据处理条款、版本历史、回收站和最终删除语义；无法证明 90 天后实际删除的远端不得用于正式归档。
- 服务器、工作目录、PocketBase 数据目录和备份介质必须使用宿主机访问控制与静态加密；归档加密不能替代本地磁盘和备份保护。
- 随机 event ID 不用于用户画像、营销或跨系统追踪。在线映射删除后，云端审计摘要不得保留可重新关联邮箱或 IP 的旁路表。
- SQLite 逻辑删除可能在 WAL、free pages 和旧备份中留下残留。备份保留期必须同步收敛；如适用规则要求介质级不可恢复删除，应在维护窗口执行经过验证的 checkpoint/VACUUM 或介质轮换，而不是由在线归档脚本直接操作 live database。
- 工程控制不替代适用法域的法律判断；若远端区域、处理目的或法定义务变化，必须先更新保留策略和数据处理记录。

## 13. 剩余风险与缓解

- 同源 XSS 仍可能读取 `sessionStorage` 中的 step-up。必须保持严格 CSP、输出转义、依赖审计和同源 header 限制；step-up 短期、绑定和轮换用于缩短影响窗口。
- 严格 IP 绑定在移动网络漂移时会要求管理员重新 Passkey 验证。这是选定的安全取舍，不允许自动放宽为仅 userId 绑定。
- 攻击者可能耗尽公开全局注册或邮件额度造成可控拒绝服务。OpenResty per-IP 洪泛层、policy 隔离、饱和告警和人工邀请码模式用于限制影响；运维告警不得共享公开全局桶。
- 仅靠本地限流不能完全阻止分布式、低速、具备大量真实邮箱的 botnet。若监控显示持续绕过，应由管理员另行批准强制邀请码或第三方人机验证；本设计不静默引入第三方追踪服务。
- age 公钥被替换可能导致归档加密给攻击者或永久不可恢复。脚本必须固定校验预期 recipient 指纹，指纹变化时停止并人工介入。
- 系统时钟大幅回拨可能影响滚动窗口和归档 cutoff。生产宿主机必须启用 NTP；检测到异常未来事件时限流和归档均 fail-closed 并告警。

## 14. 迁移与上线顺序

1. 备份并在隔离数据库验证所有迁移。
2. 创建私有集合、唯一索引和清理索引，但暂不切换公开流量。
3. 回填管理员 bootstrap 状态和既有未验证账户 lifecycle state。
4. 部署 PocketBase facade、限流模块、专用管理 API、归档内部 API 和统一邮件入口。
5. 部署 OpenResty/Caddy 真实 IP 链路并验证两个真实 IP 产生不同桶、伪造 XFF 无效。
6. 健康检查专用注册和账户邮件 facade 后，关闭原生匿名注册和原生公开账户邮件请求接口。
7. 启用严格默认策略；新桶从空状态开始，不从历史投递日志回填。
8. 撤销旧管理员验证会话，要求重新 Passkey step-up。
9. 安装 1Panel 小时归档任务、桶清理任务和未验证账户生命周期任务。
10. 先在 Mailpit 和临时数据库完成端到端验证；生产 SMTP、rclone 和 age 环境由管理员另行配置与验收。

OpenResty、Caddy 和 PocketBase 的 IP 修改视为同一部署单元，避免中间状态将全部用户识别为代理地址。紧急回滚不删除新集合或迁移数据；可关闭新业务入口，但不得重新开放绕过安全 facade 的原生发信路径。

## 15. 测试策略

### 15.1 限流与并发

- 同邮箱跨 reset/verify/change/OTP 前 2 次允许，第 3 次抑制。
- 同 IP 前 5 次允许，第 6 次抑制；全局前 30 次允许，第 31 次抑制。
- 精确测试窗口边界、邮箱大小写、IPv4/IPv6 和 IPv6 `/64`。
- 空桶并发 20–100 请求，不超卖 2/5/30；首次唯一冲突可安全处理。
- 任一桶写入失败，三个桶全部回滚。
- SQLite busy、损坏桶、异常未来时间和超大 JSON 均 fail-closed。
- 超限请求不新增 delivery log、OTP challenge 或 bucket event。

### 15.2 防枚举与错误码

- 存在、不存在、不合资格、超限和限流器故障的公开响应状态、字段、字节形态和最低耗时一致。
- fake OTP challenge 不落库，验证统一失败。
- 已登录用户详细限流码不暴露精确计数或其他身份。
- `referenceId` 不包含时间、用户、邮箱或 IP。

### 15.3 注册

- 直接原生 users create 被拒绝；所有前端入口走 facade。
- PocketBase 重启后注册额度仍存在。
- 并发注册不超过 IP、IPv6 `/64` 和全局额度。
- 注册成功但账户邮件额度已满时，账户存在、自动验证邮件不发送，可稍后统一重发。
- 第 45 天提醒最多成功发送一次；第 60 天只删除未验证且无业务关系账户。
- 迁移旧账户至少获得部署后 15 天宽限。
- 邀请码模式修改要求 Super Admin、可信 IP、step-up、CAS 和审计。

### 15.4 Passkey

- A 设备完成 step-up，B 设备即使持有同用户 token，也因 selector、secret、client-session、指纹、IP 或 UA 不匹配而失败。
- A 设备 authRefresh 后保持；登出、用户切换、过期或撤销后立即失败。
- 已 bootstrap 且 active Passkey 为零时不能一阶注册。
- 并发 bootstrap 只有一个 verify 成功。
- options 有 step-up 但 verify 缺少或更换 step-up 时失败。
- 直接 collection API 无法读取或修改 Passkey、安全策略和 bootstrap state。
- 远程删除最后一枚有效 Passkey 被拒绝。

### 15.5 IP 与旁路

- 恶意 XFF 经 OpenResty 后无效。
- 两个真实 IP 产生不同桶；Docker 网关不再成为共享 IP。
- 直连 Caddy/PocketBase 不能伪造真实 IP；PocketBase 公共端口未暴露。
- 静态扫描禁止评论 Hook 出现 `$app.newMailClient` 或 `MailerMessage`。
- 原生账户邮件路径不可公开调用；注册自动邮件、管理员测试和内部网关均有明确 policy。

### 15.6 归档与隐私

- prepare、export、JSONL、gzip、age、公钥指纹、rclone、远端 hash、manifest、commit 各阶段故障注入后数据库零误删。
- age 失败后本地无残留明文。
- 两个任务并发只预留一次；重复 upload/commit 幂等。
- 替换密文、manifest 或 age 公钥后必须 fail-closed。
- 解密归档扫描不得出现邮箱、IP、hash、业务记录 ID、正文、token、OTP、UA、SMTP 原文或未知字段。
- 90 天保留期会删除密文、manifest、版本和回收站副本；未 committed 对象不被误删。
- 每月隔离恢复演练验证三层 hash、gzip、schema、count 和 cursor。

### 15.7 全量回归

- Mailpit 端到端覆盖注册、验证重发、密码重置、换邮箱、OTP、评论通知和管理员测试。
- Astro 构建、PocketBase Hook 语法检查、Node 测试、现有认证与评论回归全部通过。
- 扫描临时数据库、构建产物、日志和 Git diff，不得出现 SMTP 凭据、完整邮箱、token、OTP、step-up secret 或 HMAC secret。

## 16. 多 Agent 实施边界

实现阶段在独立 worktree 中并行：

- Agent A：Passkey、step-up、受控 bootstrap 和后台安全 API。
- Agent B：SQLite 精确滚动桶、注册 facade、真实 IP 和邮件入口收口。
- Agent C：60 天账户生命周期、age/rclone 归档和 1Panel 运维脚本。

每个 Agent 必须先写失败测试，再实现最小修复，运行其覆盖测试并自审。主 Agent 负责接口契约、迁移顺序、冲突整合、全量验证和最终安全复核。任何生产部署、真实 SMTP、真实 rclone 上传或生产密钥配置均不在自动实施授权内。

## 17. 完成标准

只有以下条件全部成立才算完成：

1. 五项审核问题和新增注册/邮件旁路均有回归测试。
2. 严格默认配额在并发、重启和窗口边界下不超卖。
3. 超限与 decoy 请求不产生持续写盘记录。
4. 原生注册和原生账户邮件请求无法绕过 facade。
5. Passkey step-up 不能跨设备、跨标签页或跨浏览器复用。
6. 后台限流配置受硬边界、CAS、可信 IP、step-up 和审计保护。
7. 未验证账户在 45 天提醒、60 天复核后仅按规则删除。
8. 7 天日志只在 age 加密、rclone 上传和远端校验全部成功后删除。
9. 云端归档不包含可关联邮箱/IP hash 或其他禁止字段，并在 90 天后完成实际删除。
10. 全量测试、静态敏感数据扫描和最终安全复核通过。
