# Step-Up 凭证算法共享常量清单

> **用途**：step-up HMAC 绑定校验在 PocketBase hooks 与 admin-auth 服务双端实现。
> 本清单列出两端**必须保持一致**的全部常量与算法参数，作为后续修改的核对清单。
> 任何一项漂移即构成验证不一致 / 绕过路径（P0 安全风险）。

## 实现位置与所有权

| 端 | 文件 | 角色 |
| --- | --- | --- |
| admin-auth（Node.js） | `admin-auth/src/step-up-policy.mjs` | **权威实现（SOURCE OF TRUTH）** |
| PocketBase hooks（JSVM） | `pb_hooks/lib/admin_step_up.js` | 镜像实现（MIRROR，禁止独立修改） |

**修改流程**：先改 admin-auth 端 → 逐行同步 PB 端 → 对照本清单逐项核对 → 双端测试通过。

## 1. HMAC 算法参数

| 参数 | 值 | admin-auth 端 | PB 端 |
| --- | --- | --- | --- |
| 哈希函数 | HMAC-SHA256 | `createHmac('sha256', secret)` | `$security.hs256(input, secret)` |
| 输出编码 | hex（小写，64 字符） | `.digest('hex')` | `$security.hs256` 原生返回 hex |
| 密钥 | 环境变量 `ADMIN_AUTH_HASH_SECRET`，长度 **≥ 32** 字符，不足即拒绝 | 调用方传入 `hashSecret` | `hashSecret.length < 32` → forbidden |
| 输入拼接 | `namespace + ':' + value`（英文冒号分隔，value 字符串化） | `` `${namespace}:${value}` `` | `namespace + ':' + String(value)` |

## 2. Namespace 常量（5 个，逐字符一致）

| 绑定项 | namespace 字符串 |
| --- | --- |
| 凭证 secret | `step-up-secret` |
| 客户端会话 | `step-up-client-session` |
| 浏览器指纹 | `step-up-fingerprint` |
| 客户端 IP | `step-up-ip` |
| User-Agent | `step-up-ua` |

## 3. 凭证格式（`v1.{selector}.{secret}`）

| 要素 | 约束 |
| --- | --- |
| 版本前缀 | 字面量 `v1` |
| 分隔符 | `.`（点号），共 3 段 |
| selector | 18 字节随机数 → base64url = **24 字符**（`[A-Za-z0-9_-]`） |
| secret | 32 字节随机数 → base64url = **43 字符**（`[A-Za-z0-9_-]`） |
| PB 端解析正则 | `/^v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/` |
| admin-auth 端解析 | `split('.')` → 3 段且 `parts[0] === 'v1'` 且 `parts[1] === record.selector` |

## 4. 时序安全比较

| 端 | 方式 |
| --- | --- |
| admin-auth | hex 解码为 Buffer，`a.length === b.length && timingSafeEqual(a, b)` |
| PB | `$security.equal(left, right)`（恒定时间字符串比较） |

**约束**：禁止改为 `===`/`==` 直接比较；禁止提前返回的长度泄漏之外的时序侧信道。

## 5. 时间窗 / 状态判断

| 检查项 | 规则（两端一致） |
| --- | --- |
| 过期 | `Date.parse(record.expires_at) <= now` → 拒绝（边界取等号，到期即失效） |
| 过期时间解析失败 | PB 端 `!isFinite(expiresAt)` → 拒绝 |
| 撤销 | `record.revoked_at` 非空 → 拒绝 |
| 用户绑定 | `record.user !== 当前操作者 id` → 拒绝 |
| TTL | 由签发方 `sessionTtlSeconds` 决定（`expires_at = verified_at + TTL`），校验端不硬编码窗口值 |

## 6. 五元绑定校验项（顺序与完整性）

校验必须**全部通过**（AND 语义），任一项不匹配即拒绝：

1. `secret_hmac` = HMAC(`step-up-secret`, 凭证中的 rawSecret)
2. `client_session_hmac` = HMAC(`step-up-client-session`, 客户端会话标识)
3. `fingerprint_hash` = HMAC(`step-up-fingerprint`, 浏览器指纹)
4. `ip_hash` = HMAC(`step-up-ip`, 客户端 IP)
5. `user_agent_hash` = HMAC(`step-up-ua`, User-Agent)

**前置条件**（PB 端强制）：`X-Admin-Step-Up`、`X-Admin-Session`、`X-Browser-Fingerprint`、`User-Agent` 四个请求头及客户端 IP 均不得缺失。

## 7. 存储记录字段（`admin_step_up_sessions` 集合）

`user`、`selector`、`secret_hmac`、`client_session_hmac`、`fingerprint_hash`、`ip_hash`、`user_agent_hash`、`verified_at`、`expires_at`、`revoked_at`

---

**核对日期**：2026-08-05 · **核对结论**：两端实现逐行比对一致（详见当次任务报告）。
