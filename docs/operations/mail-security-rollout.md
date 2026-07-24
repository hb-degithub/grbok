# 邮件安全分阶段上线手册

本手册只描述操作顺序，不授权自动访问生产、配置真实 SMTP、上传真实云盘或接触 age 私钥。

## 前置条件

- 已备份 PocketBase 数据、当前 release、Caddy/OpenResty 配置和宿主机环境文件。
- 所有迁移已在隔离数据库同时验证全新安装与现有数据库升级。
- `scripts/pre-deploy-check.ps1 -Ci` 全部通过；Linux 环境另运行迁移验证脚本。
- 生产 PocketBase 端口未发布到公网；Caddy 只监听宿主机 loopback；OpenResty 是唯一公网入口。
- `MAIL_ARCHIVE_API_ENABLED=false`、`ACCOUNT_RETENTION_REMINDER_ENABLED=false`、`ACCOUNT_RETENTION_DELETE_ENABLED=false`。
- 真实 secret 只存在于 root 管理的生产环境文件，权限为 `0600`，未进入 Git、Compose 文件正文或命令行。

## Release 1：加法部署与流量切换

1. 部署管理 step-up、限流/桶、Outbox、账户生命周期、归档批次和 nonce 的加法迁移。
2. 部署 Node step-up 内部接口、PocketBase helper/facade、Astro 同源 header hook、注册 facade 和统一邮件网关代码。
3. 保持原生 users createRule 暂时不变；保持提醒、删除和归档任务关闭。
4. 同一维护窗口切换 OpenResty → Caddy → PocketBase 真实 IP 链：
   - OpenResty 清除客户端 XFF/X-Real-IP 后写入可信真实地址；
   - Caddy 只信任 OpenResty 实际连接地址并向 PocketBase 传递 `{client_ip}`；
   - PocketBase 业务只读取框架 real IP。
5. 用两个真实测试源验证产生不同 IP 桶；带伪造 XFF 的请求不得改变 PocketBase 看到的地址。
6. 在 Mailpit/临时数据库验证注册、首次验证、验证重发、密码重置、换邮箱、OTP、评论 Outbox 和管理员测试。
7. 验证新 Passkey step-up：同一标签页 authRefresh 后保持，其他设备/标签页/绑定变化失败。
8. 前端全部切换到注册和账户邮件 facade；确认无直接 `users.create()` 和原生 request-* 调用。
9. 新浏览器流程健康后，撤销全部旧 `admin_verified_sessions`；不得提前撤销造成管理锁死。

Release 1 验收失败时停止。保留新增集合和批次状态，不删除迁移数据；可关闭新 UI/任务，但不得回退到 PocketBase 默认 SMTP 或公开原生发信路径。

## Release 2：关闭旁路并启用严格策略

1. 再次验证 `/api/blog-auth/register` 和四类账户邮件 facade 的健康、统一响应和限流故障关闭行为。
2. 应用 cutover 迁移，将 `users.createRule` 设为 `null`。
3. 在 OpenResty/Caddy 拒绝原生注册创建、request-password-reset、request-verification 和 request-email-change；保留验证 token 的确认接口。
4. 启用严格默认策略：邮箱 `2/15m`、IP `5/15m`、账户邮件全局 `30/min`；注册 IP `3/hour`、IPv6 `/64` `10/hour`、注册全局 `20/min`。
5. 验证第 3/6/31 个账户邮件请求分别被抑制，超限不新增投递日志或 OTP challenge。
6. 验证注册和邮件额度在 PocketBase 重启后仍存在。
7. 验证评论 Hook 不含 `newMailClient`/`MailerMessage`，真实发送只经 Outbox/网关。
8. 只启用 `ACCOUNT_RETENTION_REMINDER_ENABLED=true`；保持删除关闭，观察至少一个完整任务周期和告警。
9. 验证既有未验证账户的清理时间不早于部署后 15 天，再启用 `ACCOUNT_RETENTION_DELETE_ENABLED=true`。
10. 最后配置宿主机归档环境和 1Panel 小时任务；确认 fake age/rclone 全套测试通过后才设置 `MAIL_ARCHIVE_API_ENABLED=true`。

## 归档操作边界

- `/etc/hlydwz/mail-archive.env` 与 rclone config 必须为 root-only `0600`；工作目录 `0700`。
- 服务器只保存 age recipient 公钥和预期指纹；私钥离线双份保管。
- 远端必须限定专用服务账号和 prefix，并确认数据区域、处理条款、版本历史、回收站和 90 天最终删除语义。
- 上传、回读 hash、manifest 或 commit 任一步失败都不得删除数据库日志。
- 在线最老日志超过 8 天、sealed/uploaded 批次超过 24 小时或工作目录容量越界时告警。
- 每月在隔离环境执行一次解密、三层 hash、gzip、JSONL schema/count/cursor 恢复演练。

## 紧急回滚

允许：

- 将提醒、删除、归档 API 和前端管理入口设为关闭；
- 回滚应用容器或静态前端；
- 保留并重试 prepared/sealed/uploaded 批次；
- 暂时切换注册为邀请码模式。

禁止：

- 删除新集合、桶、生命周期状态或未完成归档批次；
- 为恢复可用性而开放原生 PocketBase SMTP、原生账户邮件请求或匿名 users create；
- 删除未成功归档的 7 天以上日志；
- 跳过 Passkey step-up、可信管理 IP 或安全策略硬边界；
- 把 rclone 凭据或 age 私钥放入容器、PocketBase、Git 或诊断日志。

## 完成证据

- 全量预检和 Linux 迁移验证输出；
- 三轨代码审查与最终安全审查无 Critical/Important；
- 两真实 IP 与伪造 XFF 黑盒结果；
- 并发 2/5/30 与注册额度证据；
- Passkey 跨设备/标签页拒绝证据；
- 45/60 天生命周期临时数据库证据；
- fake age/rclone 每阶段故障注入与零误删证据；
- 归档解密敏感字段扫描零命中；
- 生产操作者单独保存的密钥指纹、远端删除语义和月度恢复记录。
