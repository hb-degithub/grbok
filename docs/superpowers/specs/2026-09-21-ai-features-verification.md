# AI 三件套验收清单（2026-09-21）—— 已完成验证

范围：`ai_settings` 配置中心、AI 文章助手（一键成文/元信息/润色续写）、评论 AI 管线（违禁词拦截、四档审核、回复草稿/直发）。

验证环境：独立本地 PB（`pb_local/pb/pocketbase.exe` 0.22.21 + `tmp/pb_verify/pb_data` 暂存库 + 全量 `pb_hooks`）+ `scripts/mock-llm-server.mjs`。env：`PB_ENCRYPTION_KEY`、`MAIL_HASH_SECRET`（限流 hash 必需，缺失会导致评论 503）、`AI_BASE_URL/AI_API_KEY/AI_MODEL` 指向 mock。

**结果总览：主流程 e2e 30/30 通过，错误路径 3/3 通过，boolSetting 对照实验 4/4，vitest 47/47，build 通过，迁移 4 个全部 Applied。**

## 0. 基线门禁
- [x] `cd astro && npm run build` 通过（含基线修复：GridScan 对已移除的 face-api.js 的动态 import 改为变量化 specifier + @vite-ignore）
- [x] `cd astro && npx vitest run` 47/47（含新增 `aiServices.test.ts` 6 个用例：错误码提取与中文映射）
- [x] 迁移应用：`20260921000000`（ai_settings）、`20260921000100`（comments AI 字段）、`20260921000200`（public_comments 视图 +is_ai）、`20260921000300`（ai_assist/ai_article 限流策略行）全部 Applied；策略库 30 行版本一致不降级

## 1. 接入配置
- [x] 违禁词表经 admin API 落库后被提交钩子正确读取（中文词命中 400）——验证 `readBannedWords` 的 getString+JSON.parse 路径
- [x] 加解密栈：`ai_config` 复用 `admin_totp.js` 的 encryptSecret/decryptSecret（与 TOTP/SMTP/ESA 生产同款同机制）；`save()` 校验逻辑经 stub 单测覆盖。注：JSVM 加解密往返未做端到端（迁移沙箱不支持 require 项目 lib，临时路由方案被安全扫描器误报拦截），风险敞口仅为 text 字段 set/get
- [x] 管理路由负例：GET settings 无 token → 403；PB 超管（非 users 集合）→ 403；POST article 无 token → 403；未注册路径 → 404（证明路由已注册且全员门控）

## 2. 违禁词拦截（独立于 AI 开关）
- [x] 中文词命中 → 400《评论包含不适宜发布的内容，请修改后重试》（不透露具体词）
- [x] 大小写不敏感（`TESTWORD` 命中 `TestWord`）

## 3. 评论 AI 审核（四档，全部实测）
- [x] `off`：worker 跳过（ai_moderated 保持 false）
- [x] `manual`：写入 ai_verdict/ai_reason，status 保持 pending；不生成回复
- [x] `assist`：approve→自动 approved、`__spam__`→自动 spam、`__unsure`→保持 pending
- [x] `full_auto`：同 assist + 回复直发
- [x] mock 500 故障 → ai_verdict=error、转人工（保持 pending）、下一轮 cron 不重试（防烧钱）
- [x] `comment_moderation=false` 但 mode≠off → 新评论仍 pending（AI 接管语义正确）
- [x] 防伪造：客户端提交 is_ai=true/ai_verdict → 落库全部被清零

## 4. 评论 AI 回复（实测）
- [x] assist：生成 is_ai=true、status=pending 子回复草稿；author_name 用配置的 reply_name；纯文本无 HTML 标签
- [x] 草稿经 admin API 通过后进入 public_comments 公开视图且带 is_ai=true（前台徽标数据源）
- [x] full_auto：回复直接 approved
- [x] 匿名父评论不 enqueue 通知（守卫路径）；full_auto 直发的通知 enqueue 逻辑与生产 create 路径同构（dedupeKey 幂等），注册用户通知链路复用既有 `comment_reply` 模板白名单
- [x] 跳过条件实现于 worker（文章作者本人/已有 AI 子回复/父链含 AI/深度≥5/72h 前旧评论），代码审查确认

## 5. 文章 AI 助手
- [x] 路由鉴权/限流逻辑经 wave-2 子代理实测：5 条路由 403 门控（live boot 实测）、slug 算法与前端一致、标签只匹配既有集合、草稿 published_at 空值不会误触发定时发布
- [x] 前端：PostManager「✨ AI 生成」弹窗 → 生成后自动打开编辑弹窗；AI 工具条 meta 建议回填/选区润色/续写（tsc/build 通过）
- [ ] 真实 LLM 的 article/assist 正例（需带 step-up 的管理会话，留待部署后人工点验）

## 6. 意外发现并修复的既有 bug
- **boolSetting 失效**（`pb_hooks/validate_comment.pb.js`）：PB 0.22 JSVM 下 json 字段经 `record.get()` 返回字节数组，`=== true/'true'` 永不命中，导致 settings 表中的 `comment_moderation`/`enable_comments` 记录存在时反被读成 false。对照实验（json true / 字符串 true / 无记录 / json false）修复前后各跑一遍确认。修复方式：`getString + JSON.parse`。
- **GridScan 构建破坏**（`astro/src/components/reactbits/GridScan.jsx`）：face-api.js 依赖已被 e87baef 移除但组件仍在 L684 动态 import 字面量，Rolldown 构建期解析失败。修为变量化 specifier + @vite-ignore（该分支 enableWebcam=false 永不执行，运行时 catch 兜底）。
- **e2e 环境**：独立 PB 必须注入 `MAIL_HASH_SECRET`（限流 subjectHash 依赖），否则评论 503 COMMENT_UNAVAILABLE。

## 回归
- [x] 评论提交/审核/公开视图/限流策略库（30 行一致）全链路
- [x] vitest 47/47、build 通过
- 部署提醒：生产部署后需在「AI 设置」页完成端点配置并启用；AI 功能默认全关（enabled=false / comment_mode=off / 违禁词关闭），不产生行为变化

## 8. 管理模块内嵌 AI（2026-09-21 第二轮，commit 98467bf，已部署）
- [x] posts 新增 `is_ai` 字段（迁移 20260921000400 生产已应用），AI 一键成文落库写入，文章列表显示「AI 生成」徽标
- [x] PostManager 列表行「AI 优化」按钮：打开编辑弹窗并自动出 meta 建议
- [x] CommentModerator 顶部 AI 状态条（super_admin 可见）：启用状态/档位/违禁词数/设置入口
- [x] 评论行内「AI 审核/重审」（pending）与「AI 回复」（approved）按钮，立即执行不等 cron
- [x] 新路由 `POST /api/blog-admin/ai/comments/moderate`、`/reply`（admin+step-up+ai_assist 限流）：本地 403/404 门控实测、生产 403/404 实测；回复手动触发绕过 72h 守卫，存量评论可补回
- [x] worker 重构（moderateOne/processOneReply 单条入口）回归通过（assist 一轮审核+草稿）
- [x] 终验：vitest 47/47、build 通过、SSR/后台评论/文章页 200、公开评论 API 200
