# 留言板设计（子项目 D）+ 后端接口契约

日期：2026-07-17
状态：已批准（用户"继续"确认）

## 范围

- 前端（本次实施）：`/guestbook` 留言板页（表单 + 留言墙 + 分页）、导航入口
- 后端（用户实现，本文件即契约）：`guestbook_messages` 集合 + 校验限流 hook

已确认决策：

- **匿名可留言**（昵称+内容，无需注册）
- **先展示后审**（默认 show，违规由 super_admin 在 PB 后台删除）
- 工作模式：只做前端，后端以接口契约保留（沿用 `validate_comment.pb.js` 的成熟模式）

## 前端设计

### `/guestbook` 页面（`astro/src/pages/guestbook.astro`）

延续设计系统：ParticleField 背景（`hidden lg:block`）+ `relative z-10` 内容 + ScrollReveal 头部（kicker "Guestbook" + h1 留言板 + 说明文案）。

**留言表单**（`components/guestbook/GuestbookForm.tsx`，client:load）

- 字段：昵称（text，≤30 字，必填）+ 内容（textarea，≤500 字，必填，右下字数统计）
- 前端预校验：去除首尾空白后非空、长度上限；不满足禁用提交
- 提交：直接 `pb.collection('guestbook_messages').create({ nickname, content, status: 'show' })`（与评论系统同模式，前端直发集合 API）
- 反馈：loading 态按钮；成功 → Toast 成功提示 + 清空表单 + 通过回调把新留言插入墙顶；失败 → Toast 错误提示（限流/校验失败时提示"提交太频繁，请稍后再试"）
- 样式：沿用设计系统卡片 + Input 组件（teal focus 辉光已有）+ Button 组件

**留言墙**（`components/guestbook/GuestbookWall.tsx`，client:load）

- 数据：`getList(page, 20, { sort: '-created', filter: 'status = "show"' })`
- 卡片：昵称首字母色块（zinc 底白字）+ 昵称 + 相对时间（x 分钟前/x 小时前/x 天前/日期）+ 内容（保留换行 `whitespace-pre-wrap`）
- stagger 入场（lib/motion variants）；底部"加载更多"按钮（`page < totalPages` 时显示，加载中 spinner）
- 空态："还没有留言，来抢沙发～"；错误态：加载失败提示 + 重试按钮
- 新留言插入：表单提交成功后通过共享状态把新记录 unshift 到列表顶

**组合**：`GuestbookBoard.tsx` 作为容器持有 messages 状态，Form 与 Wall 为其子组件（表单在上方，墙在下方）。

### 导航入口

- `Header.tsx` `MORE_LINKS` 追加 `{ href: '/guestbook', label: '留言板', ... }`
- `SideNav.tsx` `moreNavItems` 追加 `/guestbook`

### 后端接口契约（用户实现）

#### 1. `guestbook_messages` 集合（迁移）

| 字段 | 类型 | 约束 |
|---|---|---|
| `nickname` | text | required, 1–30 字 |
| `content` | text | required, 1–500 字 |
| `status` | select | 单选 show/hidden，默认 show |
| `created` | autodate | 自动 |

规则：`createRule = ""`（公开创建）；`listRule = viewRule = 'status = "show"'`；`updateRule = deleteRule = super_admin only`（后台手动删违规留言，无需专门管理页）。

#### 2. 校验限流 hook（`onRecordBeforeCreateRequest`，仿 `pb_hooks/validate_comment.pb.js`）

- nickname：去空白后 1–30 字；content：去空白后 1–500 字
- 敏感词过滤（复用评论系统词表，若有）
- per-IP 限流：建议 5 条/小时（参考评论的 `rateLimit('ip:hour:' + ip, 30, ...)`，留言板应更严）
- 强制 `status = 'show'`（忽略客户端传入的其他值——前端会传 show，hook 兜底）
- 校验/限流失败返回 400/429，前端按失败 Toast 处理

## 明确不做

- 不做回复/嵌套（留言板是单层墙）
- 不做点赞/表情反应
- 不做专门的后台管理页（PB 后台直接管理记录）
- 后端实现不属于本次工作

## 验证

- `npm run build` + check:visual 矩阵加 `/guestbook`
- 空态（集合不存在时 fetch 失败 → 错误态或空态不崩页面）截图确认
- 表单交互（Playwright）：输入校验、字数统计、提交按钮态（集合不存在时提交失败 → Toast 错误提示，页面不崩）
