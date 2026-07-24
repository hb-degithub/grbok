# 安全检测报告 — 胡巴的博客

> **检测时间**：2026-07-24
> **检测范围**：前后端源码、PocketBase hooks、admin-auth 服务、依赖、配置、部署、Docker
> **检测方法**：三个并行静态分析代理 + 人工核实关键发现 + git blame 定位引入人
> **门禁卡点**：🔴 阻断合并（必须修复） / 🟡 建议修复 / 🟢 信息性

---

## 一、问题总览

| 风险等级 | 数量 | 门禁 |
|---------|------|------|
| 🔴 高 | 4 | 阻断合并 |
| 🟡 中 | 11 | 建议修复 |
| 🟢 低 | 8 | 信息性 |

**整体评价**：项目安全基线扎实——SQL 全参数化绑定、密码/OTP 比较抗时序攻击、WebAuthn 实现正确、密钥强制从环境变量读取。主要问题集中在 XSS 净化实现缺陷、依赖版本漂移、本地密钥泄露三个面。

---

## 二、🔴 高风险问题（阻断合并）

### H1. `sanitizeText` 解码顺序错误，返回含原始尖括号的文本
- **文件**：`astro/src/lib/security.ts:147-151`
- **引入人**：HB @ `28c637a` (2026-06-24)
- **门禁**：🔴 阻断
- **问题**：`sanitizeText` 先用正则剥离 HTML 标签，**然后**把 `&lt;`→`<`、`&gt;`→`>` 等实体解码回原字符。这意味着输入 `&lt;img src=x onerror=alert(1)&gt;` 会先剥不到标签（已实体化），再解码成 `<img src=x onerror=alert(1)>`。返回值虽当前通过 React 文本节点渲染（React 二次转义，暂不触发执行），但此 API 语义上已错误——任何调用方若拼入 HTML 字符串即中招。且 `&amp;lt;` 会被部分匹配错误解码。
- **代码**：
```ts
let cleaned = text.replace(/<[^>]*>/g, '');
cleaned = cleaned.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;g', '"');
```
- **修复方案**：解码顺序应为先解码实体再剥标签，或直接返回纯文本不解码。改为：先 `&amp;` → `&`，再剥标签，不主动解码 `&lt;`/`&gt;`。

### H2. `sanitizeHtml` SSR 回退用正则解析 HTML，可被绕过
- **文件**：`astro/src/lib/security.ts:79-92`（`sanitizeHtmlFallback`），被 `security.ts:138` 在 SSR 调用
- **引入人**：HB @ `28c637a` (2026-06-24)
- **门禁**：🔴 阻断
- **问题**：文章正文在构建期经 `[slug].astro:70` 调用 `sanitizeHtml`，SSR 环境走 `sanitizeHtmlFallback`（正则移除危险标签），而非 DOMPurify。正则无法可靠解析 HTML：嵌套 `<scr<script>ipt>`、畸形注释、属性含 `>` 等可绕过。文章内容来自管理后台富文本，作者可粘贴任意 HTML，攻击面真实存在。
- **修复方案**：SSR 环境引入可用 DOM 实现（`isomorphic-dompurify` 或 `jsdom` + DOMPurify），消除手写正则回退。

### H3. 本地明文 SSH 部署私钥泄露到工作区
- **文件**：`tmp/ssh-tmp/blog_deploy_ed25519` (414 字节，Ed25519 私钥)、`tmp/ssh/blog_deploy_ed25519.pub`
- **引入人**：工作区文件（未被 git 跟踪，`.gitignore` 已覆盖 `*_ed25519`）
- **门禁**：🔴 阻断
- **问题**：真实 Ed25519 部署私钥以明文存储在 `tmp/` 目录，任何能读取该目录的进程/工具均可获取服务器部署权限。虽未被 git 跟踪，但磁盘暴露风险高。
- **修复方案**：删除明文私钥文件，移至加密密钥库（如 1Password/age），轮换该密钥对。

### H4. PocketBase 服务端(0.22.21)与 SDK(0.27.0)版本严重错位
- **文件**：`docker-compose.yml:109`（镜像 `ghcr.io/muchobien/pocketbase:0.22.21`）vs `astro/package.json:36`（`pocketbase: ^0.27.0`）
- **引入人**：HB @ `c90b149` (2026-06-22，镜像版本)
- **门禁**：🔴 阻断
- **问题**：服务端 0.22.x 与客户端 SDK 0.27.x 跨 5 个次版本，PocketBase 在此区间有破坏性 API 变更与安全修复。当前能跑通但存在未利用的安全加固与潜在 API 不兼容。
- **修复方案**：需决策升级方向（升级镜像到 0.27.x 或固定 SDK 到 0.22.x）。**此项涉及数据库迁移风险，本次仅记录不擅自修改**。

---

## 三、🟡 中风险问题（建议修复）

### M1. 评论表单缺少内容长度上限校验
- **文件**：`astro/src/components/comments/CommentForm.tsx`（全文无 `maxLength`、无 `length` 检查）
- **引入人**：HB @ `4bc7613`/`94792ad6` (2026-06-22 ~ 07-06)
- **对比**：`GuestbookForm.tsx` 有完整的 `NICKNAME_MAX=30`/`CONTENT_MAX=500`
- **修复方案**：对齐留言板的校验模式，添加昵称/内容最大长度限制与 `maxLength` 属性。

### M2. face-api.js 从第三方 CDN 加载模型，且与 CSP 摄像头策略矛盾
- **文件**：`astro/src/components/reactbits/GridScan.jsx:275,684-688,713`
- **引入人**：HB @ `78b569a` (2026-07-03)
- **问题**：(1) 模型权重从 jsDelivr 加载 GitHub 仓库 `justadudewhohacks/face-api.js@0.22.2`，若仓库被接管可注入恶意模型；(2) 调用 `getUserMedia` 访问摄像头，但 `Caddyfile` 的 `Permissions-Policy camera=()` 禁用了摄像头——生产环境功能无法工作；(3) face-api.js 0.22.2 已停止维护。
- **修复方案**：模型本地托管或移除该库；解决与 `camera=()` 的矛盾。

### M3. Admin token 存于 localStorage，无 HttpOnly 保护
- **文件**：`astro/src/lib/pocketbase.ts:25-39`、`astro/src/hooks/useAdminAuth.ts`
- **门禁**：🟡 建议
- **问题**：PocketBase SDK 默认将 auth token 存在 `localStorage`。任何 XSS（结合 H1/H2 的净化缺陷）都能读取 `pb_auth` 令牌冒充管理员。虽后台额外要求 WebAuthn passkey，但验证后仍依赖同一 localStorage token。
- **修复方案**：评估管理员令牌改用内存态 + 短期 session。

### M4. 登录速率限制纯客户端，可完全绕过
- **文件**：`astro/src/lib/security.ts:283-304`（`recordAuthFailure` 存 localStorage）、`PasswordLoginForm.tsx`
- **门禁**：🟡 建议（服务端已有 `login_security.pb.js` 兜底）
- **问题**：前端限速存 localStorage，清除即绕过。但服务端 `login_security.pb.js` 已有 per-IP/per-email 限流，前端只是 UX。注释未说明此限制。

### M5. `.env.example` 含真实生产域名
- **文件**：`.env.example:9,33`
- **门禁**：🟡 建议
- **问题**：`PUBLIC_SITE_URL=https://hlydwz.com`、`ADMIN_AUTH_RP_ID=hlydwz.com` 写入被 git 跟踪的模板文件，泄露真实域名。模板本应只含占位符。
- **修复方案**：改为 `example.com` 占位符。

### M6. 生产 CSP 允许 `script-src 'unsafe-inline'` 且 `img-src https:` 过宽
- **文件**：`Caddyfile:31`
- **门禁**：🟡 建议（注释说明为 Astro islands 所需，属已知取舍）
- **修复方案**：长期改用 nonce/hash；`img-src` 收紧 `https:` 为白名单域名。

### M7. PocketBase 容器未显式设置非 root 用户
- **文件**：`docker-compose.yml:108-130`（pocketbase 服务无 `user:` 字段）
- **修复方案**：显式设置 `user: "pb"` 或确认镜像默认非 root。

### M8. Docker 镜像未固定到 digest
- **文件**：`docker-compose.yml:12,109`、`admin-auth/Dockerfile:1`
- **修复方案**：关键镜像用 `@sha256:...` digest 固定。

### M9. face-api.js 0.22.2 停止维护，传递依赖体积大
- **文件**：`astro/package.json:32`
- **门禁**：🟡 建议（若 GridScan 不再需要则移除）

### M10. `@simplewebauthn/server` 11.x 与 `browser` 13.x 跨主版本
- **文件**：`admin-auth/package.json:12`（server ^11）、`astro/package.json:24`（browser ^13）
- **门禁**：🟡 建议（功能正常，长期需对齐）

### M11. `visitor_hash` 无盐 SHA256，数据泄露可去匿名化
- **文件**：`pb_hooks/lib/stats_lib.js:159`
- **问题**：`sha256(ip + ua + date)` 无密钥加盐，对比 `mail_crypto.js` 用了 HMAC。数据泄露可反推访客身份。
- **修复方案**：改用 HMAC + 服务端密钥。

---

## 四、🟢 低风险问题（信息性）

| 编号 | 文件 | 问题 | 引入人 |
|------|------|------|--------|
| L1 | `pb_hooks/*.pb.js`（多处） | 所有 in-memory 限速在容器重启后丢失 | HB |
| L2 | `pb_hooks/validate_comment.pb.js:55-59` 等 | `getClientIP` 回退到可伪造的 `X-Forwarded-For` | HB |
| L3 | `pb_migrations/20260627070000` | `comments.createRule` 宽松，单点依赖 hook 兜底 | HB |
| L4 | `pb_migrations/20260629060000` | `reactions` 去重靠客户端可控 fingerprint | HB |
| L5 | `pb_migrations/apply_security_rules.pb.js` | 空迁移文件名具误导性 | HB |
| L6 | `astro/src/lib/security.ts:46` | 硬编码生产域名 `hlydwz.com` 作 URL base | HB |
| L7 | `admin-auth/src/server.mjs:170-176` | `safelyLogServerError` 不记录 `err.message` | HB |
| L8 | `astro/src/components/admin/PostManager.tsx` 等 | 多处 `catch {}` 静默吞异常 | HB |

---

## 五、依赖安全扫描结果

| 依赖 | 声明版本 | 实际安装 | 状态 |
|------|---------|---------|------|
| astro | ^6.4.7 | 6.4.7 | ✅ 当前安全 |
| react | ^19.2.7 | 19.2.7 | ✅ 当前安全 |
| pocketbase (SDK) | ^0.27.0 | 0.27.0 | ⚠️ 与服务端 0.22.21 错位 (H4) |
| dompurify | ^3.4.11 | 3.4.11 | ✅ 当前安全 |
| three | ^0.180.0 | 0.180.0 | ✅ 当前安全 |
| framer-motion | ^12.40.0 | 12.40.0 | ✅ 当前安全 |
| @simplewebauthn/server | ^11.0.0 | 11.0.0 | ⚠️ 与 browser 13.x 错位 (M10) |
| @simplewebauthn/browser | ^13.3.0 | 13.3.0 | ⚠️ 见上 |
| nodemailer | 9.0.3 | 9.0.3 | ✅ 精确固定 |
| face-api.js | ^0.22.2 | 0.22.2 | 🔴 停止维护 (M2/M9) |

**Lock 文件**：`astro/package-lock.json`、`admin-auth/package-lock.json` 均存在且被跟踪。CI 若用 `npm ci` 则版本锁定。

**License 合规**：所有依赖均为宽松许可证（MIT/Apache-2.0/BSD-3），合规性良好。dompurify 的 MPL-2.0 要求修改文件保持 MPL 许可。

---

## 六、安全设计亮点（确认正确）

1. **SQL 全参数化**：PocketBase hooks 全部用 `{:param}` 绑定，无注入风险
2. **抗时序攻击**：密码/OTP 用 `$security.equal` / `timingSafeEqual`
3. **WebAuthn 实现正确**：challenge 消费、passkey owner 绑定校验到位
4. **密钥管理**：admin-auth 强制 secret ≥32 字符，全部从环境变量读取
5. **邮件安全**：`auth_facade.js` decoy + 双重限速 + 时序恒定响应；`request-auth.mjs` HMAC 签名 + nonce 防重放
6. **审计日志**：IP 脱敏处理
7. **容器加固**：`no-new-privileges` + `read_only` + `tmpfs` + 资源限制 + 端口绑定 127.0.0.1
8. **安全头完整**：HSTS/X-Frame-Options/COOP/CORP/Referrer-Policy/Permissions-Policy 齐全

---

## 七、本次修复范围（待人工确认后执行）

**将修复（代码层面，可自主完成）**：
- H1: `sanitizeText` 解码顺序
- H2: `sanitizeHtml` SSR 回退（引入 isomorphic-dompurify 或改方案）
- M1: 评论表单长度校验
- M5: `.env.example` 域名占位符化
- L6: security.ts 硬编码域名
- L7: server.mjs 错误日志
- L8: 静默 catch 补 console.warn

**需人工决策（本次不擅自改）**：
- H3: SSH 私钥删除/轮换（需你确认）
- H4: PocketBase 版本升级（数据库迁移风险）
- M2/M9: face-api.js 去留（需确认 GridScan 是否仍需要）
- M3: admin token 存储改造（架构变更）
- M7/M8: Docker 镜像加固（部署变更）
- M10/M11: 依赖对齐/HMAC 改造（需测试验证）
