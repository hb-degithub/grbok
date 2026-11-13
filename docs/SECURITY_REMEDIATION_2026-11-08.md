# 安全修复与部署验收（2026-11-08）

## 证据边界

真实 PocketBase 0.22.48 测试使用临时数据库、虚构账号与回环端口，不发送真实邮件。

### 生产部署记录（2026-11-10）

已合并并部署应用修复，生产备份位于 `/opt/hlydwz-blog/backups/pre-security-20261110-192709`。已设置 `PB_TRUSTED_PROXY_IPS=10.255.2.2/32`，AI 白名单按生产实际配置为 `https://newapi.hbdfwqmbhk.com`。SSR 已绑定 `10.255.0.1:4321`，SafeLine 管理端口已绑定 `127.0.0.1:9443`。Caddy 健康检查改为 `/api/health`。

生产验证：首页、标签页、PB health、SafeLine 管理健康均 200；关系枚举和非法邮箱确认均 400；评论动作返回受控 4xx 且 PB 无 fatal。

**源站直连封堵：已回滚（事故记录 2026-11-13）。** 最初用宿主机 systemd 防火墙 `blog-origin-guard` 对 INPUT 的 TCP 80 全量 DROP，实测外部直连超时，但 **同时把 ESA 回源也拦掉了**：SafeLine 以 host 网络监听 `0.0.0.0:80`，ESA 回源同样命中该 DROP。约 7.5 小时内该链丢弃 6.1 万个包，公网 `/api/health` 返回 522，动态接口（含 `/api/public/status`）不可用，页面仅靠 ESA 缓存显示。已 `systemctl disable --now blog-origin-guard` 并删除 unit 与脚本，回源恢复。

同一时段还把 SafeLine `backend_1` 的 `Ali-Real-Client-Ip` 覆盖为 `$remote_addr`（= ESA 节点 IP），会让所有访客共用同一限流桶；已恢复为原始透传配置（备份 `safeline-backend_1.conf`），Caddy 日志确认重新记录真实客户端 IP。

**正确做法（尚未执行，需控制台或授权）**：源站 ACL 必须是「只放行 ESA 回源地址」的白名单，不能全量封 80。步骤：① 在 ESA 控制台开启「源站防护」取得回源 IPv4/IPv6 清单（或给 RAM 子账号 `esa:UpdateOriginProtection` 权限后用 `GetOriginProtection` 读取）；② 用安全组或 `iptables` 白名单放行该清单，其余仍可 DROP；③ 验证 ESA 链路与直连两条路径。在名单为空时严禁启用任何 80 端口全量 DROP。

```bash
node scripts/test-pentest-remediation-local.mjs --suite baseline
node scripts/test-pentest-remediation-local.mjs --suite relation
node scripts/test-pentest-remediation-local.mjs --suite mail
node scripts/test-pentest-remediation-local.mjs --suite login
node scripts/test-pentest-remediation-local.mjs --suite comments
node scripts/test-pentest-remediation-local.mjs --suite fields
node --test tests/security-rate/ai_origin_guard.test.js
docker compose config -q
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e OPENRESTY_TRUSTED_PROXY=10.255.2.1 -e ADMIN_IP=192.0.2.1 caddy:2.8.4-alpine caddy validate --config /etc/caddy/Caddyfile
```

测试夹具只由 runner 注入临时 hooks 目录，不得复制到生产。

## 本地修复范围

- 非管理员集合读请求的关系路径表达式默认拒绝，覆盖大小写、集合 ID、转义引号、tags 反关系；保留合法公开 `expand` 和 `fields=expand.post_id.*`。
- 全局关系守卫只调用一次 `next(c)`，消除评论动作中的 Echo limitedReader 重入崩溃与登录双计数。
- confirm-email-change 失败统一为不含邮箱的 400；成功仍为 204；request 的站内环回门面保持原语义。
- 只有 `PB_TRUSTED_PROXY_IPS` 指定的 TCP 对端可以提供 `Ali-Real-Client-Ip`；不使用可伪造的 XFF 兜底。
- 登录限流支持 JSON、form 和长 JSON；成功仅清 email 桶，不清共享 IP 桶。
- 举报状态、评论服务端字段、文章作者/计数由 hooks 约束；敏感写操作集合解析失败即拒绝。
- AI 上游必须匹配 `AI_ALLOWED_ORIGINS` 精确 origin；保存、解析和调用前均校验，空配置默认拒绝。

## 上线前必须配置

1. 确认 Caddy 与 PB 的实际容器网络：

   ```bash
   docker inspect blog-pocketbase --format '{{json .NetworkSettings.Networks}}'
   docker inspect blog-caddy --format '{{json .NetworkSettings.Networks}}'
   ```

   在服务器 `.env` 设置 `PB_TRUSTED_PROXY_IPS` 为实际 Caddy 地址或最小容器网段，不要照抄示例。留空时所有客户端共享 Caddy IP 的限流桶，安全但粒度较粗。

2. 启用 AI 时设置 `AI_ALLOWED_ORIGINS=https://实际受信任的上游[:端口]`，多个以逗号分隔。自建同机/内网网关必须显式加入。白名单不保证受信上游开放重定向/DNS rebinding 安全；仍需容器出口控制。

3. SafeLine/OpenResty 必须清理客户端伪造的 `Ali-Real-Client-Ip`：只在可信 ESA 链路接受，转发前按可信客户端 IP 重写。Caddy 覆盖不能消除上游已经透传的伪造值。

## 源站网络边界（部署端）

Host 头不是安全边界。优先安全组：80/443 仅放行 ESA 控制台当前回源地址；9443、8090、4321 不对公网开放；22 仅管理 IP/VPN；18080/18081 保持 loopback。

1. ESA 控制台开启/查看“源站防护”，复制当前回源 IPv4/IPv6 清单；免费版不支持时，可用 ESA 回源转换规则注入秘密令牌并由 Caddy 校验作为次级方案。
2. 保留现有 SSH 会话和云控制台/VNC，先添加允许，再移除多余公网放行，IPv6 同样处理。Docker 端口可能绕过 INPUT，优先安全组，必要时验证 DOCKER-USER。
3. SSR 不再绑定公网，9443/8090 改 loopback/SSH 隧道。禁止把管理端口重新暴露为 `0.0.0.0/0`。
4. 可选 ESA 令牌须先验证 WS/SSE、图片域、监控和部署 smoke；日志删除令牌，转发到 PB/SSR 时移除。当前 Caddy 未启用该可选校验，不能宣称已部署。

官方资料：[ESA 源站防护](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/origin-protection)、[ECS 安全组](https://help.aliyun.com/zh/ecs/user-guide/add-a-security-group-rule)、[Docker 防火墙](https://docs.docker.com/engine/network/packet-filtering-firewalls/)。

## SafeLine 请求体边界

SafeLine 自建反代模式没有官方文档化的“全量 body 检测”或“超过检测上限即拒绝”开关。SDK 的 `req_body_size` 不是自建反代控制台配置；`client_max_body_size` 是传输上限，不是检测深度。

Caddy 按路由设置公开小接口 64KB、普通 API 1MB、文章/管理接口 4MB、上传 12MB；压缩 API 请求拒绝；文件下载增加 CSP sandbox 和 nosniff。这是应用侧缓解，不代表 SafeLine 检测器已修复。

部署后在非破坏测试路径验证 Content-Length 与 chunked 边界、64KB/1MB 限值、合法评论/登录/上传及截断日志。不要对线上业务写入攻击 payload。若需真正全量检测，采用官方 SDK 可调方案或向厂商确认商业版能力。

参考：[SafeLine SDK](https://github.com/chaitin/SafeLine/blob/main/sdk/lua-resty-t1k/README.md)、[自定义 nginx 参数](https://help.waf-ce.chaitin.cn/node/01975855-cd7d-78fb-a354-d2aa65a53cce)。

## 部署后验证与回滚

- 验证 ESA 链路、登录/退出、管理员 step-up、注册/邮箱确认、匿名评论与验证码编辑/删除。
- 公开文章作者展开不泄露 email/role/level；标签页正常。
- 伪造 `Ali-Real-Client-Ip` 不改变 PB 限流来源；核对容器网段。
- 外部直连源站应被安全组拒绝；9443/8090/4321 不应公开响应。
- PB/SSR/Caddy 日志无 Go fatal、重复写入或新限流误判。
- 应用用对应 Git revert 并重启 PB；Caddy 恢复旧文件后 `docker compose up -d --force-recreate caddy`；安全组回滚保留受控管理通道。
