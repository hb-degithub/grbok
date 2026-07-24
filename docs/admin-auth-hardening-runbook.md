# 管理员认证加固运维手册

> 对应设计：[docs/superpowers/specs/2026-07-01-admin-auth-hardening-design.md](../superpowers/specs/2026-07-01-admin-auth-hardening-design.md)  
> 对应计划：[docs/superpowers/plans/2026-07-01-admin-auth-hardening.md](../superpowers/plans/2026-07-01-admin-auth-hardening.md)

## 1. 所需环境

部署前请确保以下环境变量已写入 `.env`（生产）或 `.env.local`（本地）：

```bash
# Caddy 管理员 IP 白名单
ADMIN_IP=your.trusted.ip

# 内部 admin-auth 服务
ADMIN_AUTH_INTERNAL_SECRET=$(openssl rand -hex 32)
ADMIN_AUTH_HASH_SECRET=$(openssl rand -hex 32)
ADMIN_AUTH_RP_ID=your-domain.com
ADMIN_AUTH_ORIGIN=https://your-domain.com
ADMIN_AUTH_SESSION_TTL_SECONDS=900

# 供 PocketBase hook 调用 admin-auth 服务
ADMIN_AUTH_INTERNAL_URL=http://admin-auth:8787

# PocketBase 加密密钥
PB_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

> 警告：三个 32 字节 hex 密钥必须使用 `openssl rand -hex 32` 生成，禁止复制示例值。

## 2. 首次部署

1. 合并本分支后，执行部署前检查：
   ```powershell
   pwsh -File scripts/pre-deploy-check.ps1
   ```
   （Windows 若未安装 PowerShell 7，可用 `powershell.exe -File scripts/pre-deploy-check.ps1`，但 `admin-recovery.ps1` 要求 PS7+。）

2. 在服务器上启动或重启 Docker Compose：
   ```bash
   docker compose up -d
   ```

3. 确认 `admin-auth` 服务健康：
   ```bash
   docker compose logs admin-auth
   curl -f http://localhost:8787/health
   ```

4. 确认 Caddy 只放行白名单 IP 到管理后台：
   ```bash
   curl -I https://your-domain.com/admin
   # 非白名单 IP 应返回 403
   ```

5. 执行所有检查脚本：
   ```powershell
   pwsh -File scripts/check-admin-routes.ps1
   pwsh -File scripts/check-pb-admin-auth.ps1
   pwsh -File scripts/check-admin-recovery.ps1
   pwsh -File scripts/sensitive-check.ps1
   ```

## 3. 首次注册 Passkey

1. 在白名单 IP 环境下，使用超级管理员账号登录博客。
2. 进入 `/admin/security`（安全中心）。
3. 在「管理员 Passkey」卡片中输入标签（如 "MacBook Pro 主密钥"），点击「注册新 Passkey」。
4. 按浏览器提示完成硬件密钥/指纹/面容注册。
5. 重复至少一次，注册备用 Passkey。
6. 退出并重新登录，确认需要 Passkey 验证才能进入 `/admin`。

> 注意：在强制启用 Passkey 验证前，请确认已注册至少两个 Passkey，避免单点失效。

## 4. 恢复流程（服务器本地）

当超级管理员丢失所有 Passkey 或无法完成验证时，使用服务器本地恢复脚本。

### 4.1 生成恢复码（临时/一次性）

当前仓库未提供自动批量生成脚本，建议按以下方式生成：

```bash
# 在服务器安全目录中生成一个 32 字节 hex 恢复码
openssl rand -hex 16
# 示例输出：a1b2c3d4e5f6...
```

将其 SHA-256 哈希存入 PocketBase `admin_recovery_codes` 表：

```bash
# 计算哈希（Linux/macOS）
echo -n "YOUR_RECOVERY_CODE" | sha256sum
```

在 PocketBase 后台 `/pb/_/?collection=admin_recovery_codes` 创建记录：
- `user`: 目标管理员用户
- `code_hash`: 上述哈希（小写）
- `expires_at`: 30 天后的 ISO 8601 时间
- `used_at`: 留空

### 4.2 执行恢复

SSH 登录服务器，运行：

```powershell
pwsh -File scripts/admin-recovery.ps1 `
  -UserEmail admin@your-domain.com `
  -Action issue-reenroll
```

`-Action` 可选值：
- `issue-reenroll`: 撤销旧 Passkey 并清除验证会话，允许重新注册。
- `revoke-passkeys`: 仅撤销该用户的所有 Passkey。
- `clear-sessions`: 仅清除该用户的已验证会话。

脚本会提示输入：
1. PocketBase admin token（或从环境变量 `POCKETBASE_ADMIN_TOKEN` 读取）
2. 恢复码（隐藏输入）

> 恢复码输入不会回显，也不会进入 shell history。

### 4.3 恢复后

1. 立即重新注册至少两个 Passkey。
2. 删除或标记已使用的恢复码记录。
3. 检查 `audit_logs` 中的 `recovery:*` 事件。

## 5. 回滚

如果部署后出现问题，可按以下顺序回滚：

1. 回滚到上一个稳定镜像或 Git 提交。
2. 停止 `admin-auth` 服务：
   ```bash
   docker compose stop admin-auth
   ```
3. 在 PocketBase 中清空 `admin_passkeys` 表（可选，将关闭 Passkey 验证）。
4. 重新部署旧版本前端，确保 `/admin` 不再检查 `admin_verified_sessions`。
5. 验证 `/admin` 可用且登录正常。

> 回滚期间，管理员仍可通过 PocketBase 原生密码/MFA 登录，但会失去 Passkey 这层保护。

## 6. 验证命令清单

```powershell
# 1. 检查 Caddy 管理路由保护
pwsh -File scripts/check-admin-routes.ps1

# 2. 检查 PocketBase schema 与 hook
pwsh -File scripts/check-pb-admin-auth.ps1

# 3. 检查恢复脚本结构
pwsh -File scripts/check-admin-recovery.ps1

# 4. 检查敏感文件/密钥
pwsh -File scripts/sensitive-check.ps1

# 5. 检查 admin-auth 单元测试
Set-Location admin-auth
npm test

# 6. 检查 Astro 构建
Set-Location astro
npm run build

# 7. 部署前全量检查
Set-Location ..
pwsh -File scripts/pre-deploy-check.ps1
```

## 7. 安全注意事项

- 恢复码必须 server-side 生成，展示一次，存储哈希，30 天过期，单次使用。
- 永远不要把恢复码作为命令行参数传入 `admin-recovery.ps1`。
- 永远不要在提交或 issue 中贴出 admin token、密钥或恢复码。
- 审计日志优先使用 `user_id`，默认不记录完整 IP。
- 管理员后台访问应始终通过白名单 IP、Tailscale/WireGuard 或 mTLS，不要直接暴露到公网。

## 8. 故障排查

| 现象 | 排查方向 |
|------|---------|
| `/admin` 提示需要 Passkey 验证 | 确认已注册 Passkey；检查 `admin_verified_sessions` 是否绑定同一浏览器指纹/IP。 |
| 注册 Passkey 失败 | 确认 `admin-auth` 服务运行；检查 `ADMIN_AUTH_RP_ID` 和 `ADMIN_AUTH_ORIGIN` 与域名一致。 |
| 恢复码无效 | 确认哈希算法为 SHA-256；确认未过期、未使用；确认大小写一致。 |
| Caddy 返回 403 | 确认请求 IP 在 `ADMIN_IP` 列表中；检查 Caddyfile 是否包含 `@blocked_admin_access`。 |
