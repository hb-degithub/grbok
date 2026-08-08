# 胡巴博客后续计划路线图（2026-08）

> 本文档汇总安全、架构、代码质量、性能、数据库、部署运维、前端体验七个维度的专项审计结果（含架构/代码质量/安全审查完整版补充发现），制定分优先级的后续改进计划。
>
> 制定日期：2026-08-05 ｜ 依据：七路专项审计报告及完整版补充 ｜ 维护人：产品与技术团队

---

## 一、概述

七维度审计显示：项目**安全基线整体扎实**（CSP/HSTS 大体完备、SQL 注入面为零、迁移幂等规范、CI 硬门禁有效），但存在三类突出风险：

1. **运维体系是最薄弱环节（3.3/10）**：bind mount 删除重建部署曾致全站 404 事故、pb_data 无备份、零监控告警，属于"随时可能再出事故"级别，必须本周止血。
2. **性能债沉重（5.4/10）**：字体占产物 76%（16.5MB）、首页 57 个岛屿、动效库整包引入，直接影响用户体验与 SEO。
3. **安全存在唯一可直接远程利用的严重缺口（S-1）**：TOTP 验证端点无限流，窃取 admin token 后可在线爆破 6 位 TOTP 码（10 req/s 期望约 14 小时命中），且与 CSP unsafe-inline、token 存 localStorage 构成完整后台接管链，必须最优先修复。

架构层面新发现 **step-up HMAC 双端重复实现**（算法漂移即产生绕过路径）与**内部通信两套认证混用**，列为 P0/P1 级收敛项。同时，**测试覆盖近乎空白**（221 个前端模块仅 26 个用例）与**超大组件**问题制约组件独立性与可维护性这一既定目标，列为 P2/P3 主线持续投入。

### 审计评分总览

| 维度 | 评分 | 状态 | 核心问题 |
|---|---|---|---|
| 安全 | 7.0/10 | 🟠 待改进 | **S-1 TOTP 验证无限流（可远程爆破）**、ESA 密钥明文+入备份包、PB 版本错位、备份未加密、ADMIN_IP 未 fail-closed；修复 S-1 与 ADMIN_IP fail-closed 后可达 8.5 |
| 架构 | 7.5/10 | 🟡 良好 | step-up 双端重复、4 套限流并存、认证逻辑散落 5 模块、内部通信两套认证混用 |
| 代码质量 | 5.9/10 | 🟠 较差 | 测试覆盖灾难、超大组件（MailCenter 32KB 等）、GridScan 规范违规、仓库残留脚本 |
| 性能 | 5.4/10 | 🔴 较差 | 字体 16.5MB、57 岛屿、动效库整包 770KB |
| 数据库 | 7.0/10 | 🟡 良好 | 无备份策略、SDK 版本错位、cron 缺异常保护 |
| 部署运维 | 3.3/10 | 🔴 薄弱 | 部署模式危险、无备份、无监控、健康检查失效、bind mount 配置漂移 |
| 前端体验 | 8.4/10 | 🟢 良好 | 动效不响应 reduced-motion、SEO 缺结构化数据 |

---

## 二、P0：本周内完成（止血类）

> 目标：消除"随时可能丢数据/再出全站事故/后台被远程接管"的风险。总工作量约 **35-46 小时**。

| # | 任务 | 来源审计项 | 工作量 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| P0-1 | **TOTP 验证端点限流（S-1）**：/api/blog-admin/totp/verify 复用 security_rate_limit.js 按 actorId 限流（5 次/5 分钟，超限锁定 15 分钟+审计日志），参考 auth_otp.js 的 5 次尝试模式。**全审计唯一可直接远程利用的严重缺口，成本最低收益最大，最优先执行** | 安全终版 S-1 | 4h（约 0.5 天） | 无 | 连续 5 次错误 TOTP 后锁定 15 分钟；锁定状态持久化（重启不丢失）；锁定/解锁均写入审计日志；正常用户验证流程不受影响 |
| P0-2 | **pb_data 自动备份体系**：每日 cron tar 备份，保留 14 天，异地副本（OSS/另一台机器），备份包加密（gpg/openssl） | 安全①③ / 数据库高危 / 运维 P0③（三路交叉，合并） | 6-8h | 无 | cron 每日执行成功；备份文件加密且可解密恢复；异地存在副本；执行一次恢复演练成功 |
| P0-3 | **部署流程修复**：废弃 bind mount + 删除重建模式，改 `rsync -a --delete` 原地更新；清理 20+ 个 backup-* 残留目录；生产/本地 docker-compose 卷模式对齐（消除 bind mount vs 命名卷配置漂移） | 运维 P0①/P1 / 架构补充⑥（交叉合并） | 5-7h | 无 | 部署过程不删除目标目录；部署后 Caddy 无需重启即可识别新文件；模拟部署验证无 404 窗口；生产与本地 compose 卷策略一致 |
| P0-4 | **Caddy 健康检查修正**：由仅探 `/api/health` 改为同时探静态文件 `/index.html` | 运维 P0② | 1-2h | 无 | 静态文件缺失时健康检查失败并触发告警；正常时双探针均通过 |
| P0-5 | **ESA 密钥轮换与凭据收敛**：吊销当前 AK/SK，改用 STS 临时凭证；ESA 凭据从 cache_admin.pb.js 迁出，仅存于 admin-auth；从备份包与历史备份中清除明文密钥 | 安全① / 架构 | 4-6h | P0-2（先有新备份再轮换） | 旧密钥已吊销；生产 .env 不再含明文 AK/SK；缓存刷新功能经 STS 正常调用；新备份包无明文密钥 |
| P0-6 | **基础监控告警上线**：Gatus 外部探活（前台首页 + /api/health）+ cron 容器/资源轮询 + 邮件告警（复用 msmtp） | 运维 P2（提前） | 6-8h | P0-4 | 站点宕机/接口异常 5 分钟内收到告警邮件；容器重启、磁盘>85%、内存>90% 触发告警；内存增量 <30MB |
| P0-7 | **PB SDK 版本止血**：锁 SDK 至 `~0.22.0` 与服务端 0.22.21 对齐，消除跨 5 个次版本错位 | 安全② / 数据库高危（短期项） | 2-3h | 无 | package.json 锁定 ~0.22.0；全量构建通过；前后台核心流程（登录/发文/评论）回归通过 |
| P0-8 | **1Panel-mysql OOM 处置**：限制内存上限或下线该容器（RestartCount 5404 重启循环） | 运维 P1 | 1-2h | 无 | 容器不再重启循环；如保留则内存限制生效且业务正常 |
| P0-9 | **step-up 双端重复止血**：在 pb_hooks/lib/admin_step_up.js 与 admin-auth/step-up-policy.mjs 两端添加算法所有权注释（声明 admin-auth 为实现源、PB 端为镜像），并核对两端 HMAC 逻辑当前一致性 | 架构补充①（短期项） | 2-3h | 无 | 两端文件头部均有所有权/同步注释；人工 diff 确认当前算法一致；发现不一致立即以 admin-auth 为准修正 |
| P0-10 | **GridScan 导出规范修复**：GridScan.jsx 命名导出改 export default，移除 LoginGridScanBackground 的 lazy hack 包装，简化导入 | 代码质量补充① | 1-2h | 无 | GridScan.jsx 使用 export default；lazy hack 删除；登录页背景渲染正常；astro check / eslint 通过 |
| P0-11 | **本地测试加密密钥更换（M-3）**：.env.local 的 PB_ENCRYPTION_KEY 固定值（a1b2c3d4e5f6...）改为 `openssl rand -hex 32` 随机值；PB 启动脚本增加弱密钥模式检测（命中已知测试值/过短/纯序列则拒绝启动并告警） | 安全终版 M-3 | 4h（约 0.5 天） | 无 | .env.local 使用随机密钥；启动检测脚本可识别弱密钥模式并阻断；文档注明该密钥泄露可解密 TOTP 密钥/SMTP 密码/ESA 凭证，严禁复制到生产 |

---

## 三、P1：2 周内完成

> 目标：修复中危安全项、推进"XSS→token→TOTP 接管链"专项、收敛内部通信认证、补齐 SEO 与合规短板、建立自动部署能力。总工作量约 **50-66 小时**。

| # | 任务 | 来源审计项 | 工作量 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| P1-1 | **reaction 限流改造**：内存实现迁移至 security_rate_limit 持久化方案 | 安全中危 / 数据库中危 / 架构（交叉合并） | 3-4h | 无 | reaction 接口限流持久化生效；重启 PB 后限流计数不丢失 |
| P1-2 | **Caddy IP 白名单 fail-closed（H-1）**：ADMIN_IP 默认值由 0.0.0.0/0 改为空；Caddyfile 未配置 ADMIN_IP 时对 /admin/* respond 404（fail-closed）；部署文档列为必填项；新增启动检查脚本验证 ADMIN_IP 已配置 | 安全中危 / 安全终版 H-1 细化 | 2-3h | 无 | 未配置 ADMIN_IP 时后台路径返回 404；配置后仅白名单 IP 可访问；启动脚本在缺失配置时给出明确报错；部署文档含必填说明 |
| P1-3 | **admin token 存储加固（H-3，接管链专项②）**：管理后台改为内存态 authStore（token 不落 localStorage/sessionStorage，刷新后重新登录）；/api/admins/* 接口收敛 | 安全中危 / 安全终版 H-3 方案细化 | 4-6h | 无 | DevTools 中 Web Storage 无 token；页面刷新后需重新认证；/api/admins/* 不再公开暴露 |
| P1-4 | **cron 任务异常保护**：account_retention、scheduled_publish 增加 try/catch 与失败告警 | 数据库中危 | 2-3h | P0-6 | cron 异常被捕获并记录日志；失败时触发邮件告警 |
| P1-5 | **settings 公开白名单收敛**：移除 debug_protection_enabled 等敏感项的公开可读 | 数据库中危 | 1-2h | 无 | 未认证请求无法读取敏感 settings 键 |
| P1-6 | **face-api.js 依赖移除**：当前 enableWebcam=false 功能未启用，直接移除 face-api.js 依赖、模型加载与相关死代码（优先于自托管方案） | 安全中危 / 安全终版补充事实 | 4h（约 0.5 天） | 无 | package.json 无 face-api.js 依赖；模型文件与加载代码删除；构建产物体积下降；无运行时报错 |
| P1-7 | **SEO 补强**：Article JSON-LD 结构化数据、canonical 链接、robots.txt 增加 sitemap 引用 | 前端体验 | 4-6h | 无 | Google Rich Results 测试通过；查看源码存在 canonical 与 JSON-LD；robots.txt 含 Sitemap 行 |
| P1-8 | **prefers-reduced-motion 支持**：13 个 effects 组件全部响应系统减弱动效偏好（WCAG 2.3.3） | 前端体验 | 6-8h | 无 | 开启系统减弱动效后，所有动效降级/关闭；axe/Lighthouse 无相关违规 |
| P1-9 | **自动部署流水线**：deploy.yml 实现 制品下载→rsync→重启→探活→失败回滚 | 运维 P2 | 8-10h | P0-3、P0-4 | CI 推送后自动部署成功；探活失败自动回滚至上一版本；全程无需人工 SSH |
| P1-10 | **迁移健壮性补齐**：4 个空 down 迁移补齐回滚逻辑；删除 apply_security_rules.pb.js 占位文件与重名 TOTP 冗余迁移 | 数据库中/低危 | 3-4h | 无 | 所有迁移 down 可执行回滚；pb_migrations 无占位/冗余文件 |
| P1-11 | **admin-auth 第 4 套限流处置**：server.mjs 的 isLegacyRateLimited（内存 30 req/min/IP）豁免 /health 路径避免误伤容器健康检查，并标注为待收敛实现 | 架构补充②（短期项） | 1-2h | 无 | /health 不受限流影响；容器健康检查持续通过；代码注释标明该实现将并入统一限流 |
| P1-12 | **内部通信认证统一**：所有 /internal/* 路由（session/step-up）统一走 HMAC 签名（带时间戳/nonce），X-Internal-Secret 降级为第二层校验并标注移除计划 | 架构补充④ | 5-7h | 无 | /internal/* 全部校验 HMAC；无有效签名请求被拒；X-Internal-Secret 仅作辅助层并有 TODO 移除标注 |
| P1-13 | **死代码 health 路由清理**：blog_auth.pb.js 与 blog_register.pb.js 末尾 IIFE 之外的死代码 health 路由移入 IIFE 或删除，消除重复注册 panic 风险 | 架构补充③ | 1h | 无 | IIFE 外无游离路由注册代码；PB 启动无重复注册告警；前端功能无影响（前端未调用） |
| P1-14 | **CSP script-src 收紧（H-2，接管链专项①，短期）**：对 /admin/* 路径单独收紧 script-src 为 'self'（去除 unsafe-inline）；全站方案（构建期 SHA-256 哈希或 nonce）在 P2 评估实施 | 安全终版 H-2 方案细化 | 3-4h | 无 | /admin/* 响应头 script-src 不含 unsafe-inline；后台页面无 CSP 阻断报错；前台不受影响 |

---

## 四、P2：1 个月内完成

> 目标：性能攻坚 + 可维护性主线第一阶段（测试补齐、超大组件拆分启动、架构收敛）+ 接管链专项收尾。总工作量约 **94-126 小时**。

### 4.1 性能攻坚

| # | 任务 | 来源审计项 | 工作量 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| P2-1 | **字体瘦身**：改用可变字体或精简分片，602 文件/313 条 @font-face 收敛，目标减量 12-14MB | 性能 | 8-12h | 无 | 字体产物 ≤4MB；页面视觉无回退；Lighthouse 字体相关审计通过 |
| P2-2 | **首页岛屿治理**：57 岛屿收敛（目标 ≤30）；移除 SplashOverlay 强制 2.5s 等待；MagicBento 改 client:visible | 性能 | 8-10h | 无 | 首页岛屿数 ≤30；无强制等待；首屏 LCP 改善 ≥30% |
| P2-3 | **动效库按需加载**：Framer（142KB 全站）改动态导入、GSAP（111KB）单组件按需、Three（516KB）仅登录页路由级懒加载 | 性能 | 6-8h | 无 | 非登录页产物不含 Three；首页 bundle 不含 GSAP；动效功能正常 |
| P2-4 | **bundle 与 CSS 优化**：react-vendor 分包、关键 CSS 内联、BaseLayout.css 511KB 瘦身 | 性能 | 6-8h | P2-3 | 主 bundle ≤400KB；BaseLayout.css ≤300KB；无样式回退 |

### 4.2 可维护性主线（既定目标：组件独立性与可维护性）

| # | 任务 | 来源审计项 | 工作量 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| P2-5 | **核心测试补齐（Top10 细化版）**：security.ts 扩展（RateLimiter/指纹/CSRF）、pb-error.ts、useAdminPosts、useMailCenter、mailService、authService、useComments、CommentForm、AdminGuard、baseService；另覆盖 blog-auth-client、admin-step-up、commentService、postService、useAuth | 代码质量（含补充④） | 18-24h | 无 | 上述模块单测覆盖核心分支；测试总数 ≥120 用例；前端覆盖率 ≥30%；CI 全部通过 |
| P2-6 | **限流体系统一**：login_security_lib 自研内存、validate_comment 内嵌、admin-auth isLegacyRateLimited（P1-11 已豁免健康检查）全部收敛至 security_rate_limit 持久化方案；删除 registration_rate_limit 空壳 | 架构（含补充②，4 套合并为一项） | 8-10h | P1-1、P1-11 | 全站限流仅一套持久化实现；空壳与 legacy 实现删除；限流行为回归通过 |
| P2-7 | **认证客户端合并**：blog-auth-client / admin-auth-lifecycle / admin-step-up / admin-recovery-header / blog-auth-facade 五模块合并为统一认证层 | 架构 | 10-12h | P1-3、P2-5（先有测试保护） | 认证逻辑单一入口；5 模块文件归档或删除；登录/后台认证全流程回归通过 |
| P2-8 | **step-up 单源化（中期）**：PB 端 admin_step_up.js 改为调用 admin-auth 的 /internal/step-up/verify（加 5-10s 缓存），消除双端算法漂移风险 | 架构补充①（中期项） | 5-7h | P0-9、P1-12（依赖统一 HMAC 通道） | PB 端不再独立实现 HMAC 验证；step-up 验证经 admin-auth 单源完成；缓存生效且验证延迟可接受；后台 step-up 流程回归通过 |
| P2-9 | **超大组件拆分（第一批）**：MailCenter.tsx（32KB，按 8 个 Tab 拆子组件）、GridScan.jsx（30KB）、WelcomeOverlay.tsx（28KB，按步骤拆）；同步处理 index.astro（985 行）与 MagicBento.tsx（704 行） | 代码质量（含补充②修正）/ 既定目标 | 12-16h | P2-5、P0-10 | 单文件 ≤300 行；子组件可独立测试；页面功能无回退 |
| P2-10 | **仓库卫生治理**：scripts/ 删除 8 个废弃脚本；根目录 7 组残留脚本归置或删除（start-dev-* 归置到 scripts/dev/）；final-fixes.js 等已被 git 跟踪文件先 `git rm --cached` 再删除；tmp/ 归档；README.md 与 CLAUDE.md 同步更新（补 admin-auth/tests/scripts 说明与新功能） | 代码质量（含补充⑤细化） | 4-6h | 无 | 根目录无残留脚本；.gitignore 规则与实际跟踪状态一致；scripts/ 仅保留在用脚本；README 与现状一致 |
| P2-11 | **移动端适配收尾**：落实 mobile-adaptation-plan.md 剩余 40-50%，补专属移动导航 | 前端体验 | 10-12h | 无 | 计划内项目全部落地；移动导航可用；主流机型视口下无横向滚动/遮挡 |
| P2-12 | **地图数据自托管**：geoConstants 领土数据自托管，去除第三方 CDN 依赖（合规） | 前端体验 | 3-4h | 无 | 地图数据从自有域名加载；离线构建产物包含数据文件 |
| P2-13 | **reactbits 目录治理**：4 个已本地化组件（ScrollVelocity/PixelCard/Masonry/MagicBento）依赖项目 useBreakpoint，破坏第三方目录纯度，移至 effects/ 或在 README 标注本地化修改；对 Kim 判定零引用的 8 个组件（AnimatedContent/BlurText/Carousel/GlareHover/MagicBento/Particles/ScrollFloat/ScrollVelocity/Stack），**执行删除前必须二次核实实际引用**（含 index.astro 直接 import、astro-island 引用路径非 `../reactbits/X` 的情况），避免误删线上在用组件 | 架构补充⑤ / 代码质量补充③（合并） | 3-4h | 无 | reactbits/ 保持第三方纯度或有明确标注；引用核实清单产出并经确认；确认零引用的组件安全删除且构建/页面无回退 |
| P2-14 | **CSP script-src 全站收紧（H-2，接管链专项①，长期方案）**：构建期为内联脚本生成 SHA-256 哈希或 nonce，全站去除 script-src unsafe-inline | 安全终版 H-2 方案细化 | 4-6h | P1-14（/admin/* 短期收紧已验证） | 全站 script-src 不含 unsafe-inline；所有页面无 CSP 阻断报错；构建流程自动生成哈希/nonce |

---

## 五、P3：长期演进（1 个月后）

> 目标：架构升级与体验深化，持续提升可维护性。工作量按迭代规划。

| # | 任务 | 来源审计项 | 工作量 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| P3-1 | **PB 升级 0.27 规划与实施**：hooks 按新 JSVM API 适配，迁移仅新库 bootstrap 需要；先行在测试环境验证 | 安全② / 数据库（中期项，与 P0-7 分列） | 16-24h | P0-7、P2-5、P2-7 | 测试环境 0.27 全功能回归通过；制定回滚方案；生产升级窗口内完成 |
| P3-2 | **超大组件拆分（第二批）**：PostContent.tsx（665 行）、AuthPage.tsx（557 行）、SearchModal.tsx（520 行） | 代码质量 / 既定目标 | 10-14h | P2-9 | 单文件 ≤300 行；子组件独立可测 |
| P3-3 | **测试覆盖扩展**：组件层与 hooks/domains 其余模块，目标前端覆盖率 ≥60% | 代码质量 | 持续投入 | P2-5 | 覆盖率报告 ≥60%；CI 门禁纳入覆盖率阈值 |
| P3-4 | **样式体系统一**：Tailwind 为唯一方案，global.css 794 行逐步迁移，魔法数字令牌化（design tokens） | 前端体验 | 12-16h | P2-4 | global.css ≤200 行；间距/色值全部走 token；无内联样式散落 |
| P3-5 | **技术债清理**：deprecated usePocketBase 移除、两套认证端点并轨、X-Internal-Secret 辅助层移除 | 架构（含补充④长期项） | 5-7h | P2-7、P1-12 | 无 deprecated 引用；认证端点唯一；内部通信仅 HMAC 单机制 |
| P3-6 | **step-up 长期单源**：抽取 JSON Schema 作为算法单源，双端代码由 Schema 生成 | 架构补充①（长期项） | 8-10h | P2-8 | 算法定义单源化；双端实现由生成产出；漂移在构建期即被检测 |
| P3-7 | **E2E 测试体系**：Playwright 覆盖核心链路（发文/评论/登录/后台管理） | 代码质量 | 12-16h | P2-5 | 核心链路 E2E 用例 ≥15 条；CI 定时执行通过 |
| P3-8 | **监控深化**：告警分级、uptime 报表、性能指标（LCP/CLS）持续采集 | 运维 | 6-8h | P0-6 | 告警分级生效；周报自动生成 |

---

## 六、依赖关系说明

```
P0-1（TOTP 限流 S-1）── 独立最优先，无依赖
P0-2（备份）──→ P0-5（ESA 密钥轮换，先有新备份再动密钥）
P0-3（部署修复）──→ P0-4（健康检查）──→ P1-9（自动部署）
P0-4（健康检查）──→ P0-6（监控告警，探针是告警基础）
P0-6（监控）──→ P1-4（cron 告警复用邮件通道）
P0-7（SDK 止血）──→ P3-1（0.27 升级，先对齐再规划升级）
P0-9（step-up 注释止血）──→ P2-8（step-up 单源化）──→ P3-6（JSON Schema 生成）
P0-10（GridScan 导出修复）──→ P2-9（GridScan 拆分，先规范化再拆分）

【接管链专项：P0-1（S-1 爆破阻断）→ P1-14（H-2 /admin CSP 收紧）→ P1-3（H-3 内存态 token）→ P2-14（H-2 全站哈希/nonce），整体推进】
P1-14（/admin CSP 收紧）──→ P2-14（全站 CSP 收紧，先小范围验证再全站）
P1-1（reaction 限流持久化）──→ P2-6（限流统一，先验证方案再全面收敛）
P1-11（legacy 限流豁免/health）──→ P2-6（限流统一）
P1-12（内部通信 HMAC 统一）──→ P2-8（step-up 单源化依赖统一通道）──→ P3-5（X-Internal-Secret 移除）
P1-3（token 加固）──→ P2-7（认证合并，存储机制先定型）
P2-5（核心测试）──→ P2-7 / P2-9 / P3-1（重构与升级前必须有测试保护）
P2-3（动效按需）──→ P2-4（bundle 优化，先减库再分包）
P2-9（拆分第一批）──→ P3-2（拆分第二批，验证拆分方法论）
```

**关键路径**：P0-3 → P0-4 → P1-9（部署自动化链路）；P2-5 → P2-7 → P3-1（认证重构与 PB 升级链路）；P0-9 → P1-12 → P2-8 → P3-6（step-up 单源化链路）；P0-1 → P1-14/P1-3 → P2-14（接管链专项链路）。

---

## 七、里程碑建议

| 里程碑 | 时间 | 目标 | 包含任务 |
|---|---|---|---|
| **M1 止血完成** | 2026-08-12（本周末） | S-1 爆破缺口封堵、数据可恢复、部署不再出事故、宕机可感知、step-up 漂移风险受控 | P0 全部（11 项） |
| **M2 安全与合规达标** | 2026-08-19（2 周后） | 中危安全项清零、接管链三环全部断开（/admin CSP+内存 token+TOTP 限流）、内部通信认证统一、SEO/无障碍/合规补齐、自动部署上线 | P1 全部（14 项） |
| **M3 性能与可维护性阶段** | 2026-09-05（1 个月后） | 产物减量 ≥12MB、岛屿 ≤30、核心模块有测试保护（覆盖率 ≥30%）、限流/认证/step-up 收敛、全站 CSP 去 unsafe-inline | P2 全部（14 项） |
| **M4 架构升级** | 2026-10 月 | PB 0.27 升级完成、覆盖率 ≥60%、样式体系统一、step-up Schema 单源 | P3 滚动推进 |

---

## 八、工作量汇总

| 级别 | 任务数 | 预估工作量 | 说明 |
|---|---|---|---|
| P0 | 11 项 | 35-46h（约 4.5-6 人日） | 本周内，止血（含 S-1 与 M-3） |
| P1 | 14 项 | 50-66h（约 6.5-8.5 人日） | 2 周内（含接管链专项） |
| P2 | 14 项 | 94-126h（约 12-16 人日） | 1 个月内 |
| P3 | 8 项 | 75-101h（滚动规划） | 长期演进 |
| **合计** | **47 项** | **约 254-339h** | 按 1 名全栈投入估算约 7-9.5 周 |

> 注：以上为单人估时；若性能攻坚（P2-1~P2-4）与可维护性主线（P2-5~P2-9）并行投入两人，M3 可提前约 1 周。

---

## 九、风险与注意事项

1. **【XSS→token→TOTP 接管链专项】** 安全终版确认 H-2（CSP script-src unsafe-inline）+ H-3（admin token 存 localStorage）+ S-1（TOTP 无限流）构成完整后台接管链：XSS 注入窃取 token → 在线爆破 TOTP（10 req/s 期望约 14 小时）→ 完全接管后台。**三项必须作为一个安全专项整体推进**：P0-1 先堵爆破缺口（成本最低收益最大），P1-14 对 /admin/* 短期收紧 script-src 'self'，P1-3 改内存态 authStore，P2-14 全站构建期哈希/nonce 收尾。任一单环修复都不能完全切断链路，M2 前需三环齐断。
2. **P0-5 ESA 密钥轮换**需先在测试环境验证 STS 调用链路，避免缓存刷新功能中断。
3. **P2-7 认证合并与 P3-1 PB 升级**为高风险重构，必须以 P2-5 测试补齐为前提，且安排在低峰期窗口执行。
4. **P2-8 step-up 单源化**引入 PB → admin-auth 的内部调用，需评估网络分区时的降级策略（缓存窗口内放行 vs 拒绝），并在 P1-12 统一 HMAC 通道后实施。
5. **P2-13 reactbits 组件删除**存在审计结论矛盾（静态分析零引用 vs 性能审计实测首页存在 astro-island），**必须先产出引用核实清单并人工确认**，严禁直接按静态分析结果删除。
6. **P0-11 本地测试密钥更换**后需同步团队：PB_ENCRYPTION_KEY 泄露可解密 TOTP 密钥/SMTP 密码/ESA 凭证，严禁将本地值复制到生产；启动检测脚本为最后防线。
7. **P2-1 字体瘦身**涉及视觉回归，需设计走查确认字重覆盖完整后再上线。
8. 备份体系（P0-2）上线后，**每月至少一次恢复演练**，避免"备份存在但恢复失败"。
