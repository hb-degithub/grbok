# 导航折叠栏 + 访问统计系统设计

日期：2026-07-17
状态：已批准（用户"继续"确认）

## 背景

全站动效增强已完成（commit 0f81e3b、4174cfd）。用户提出两个新需求：

1. 顶部导航不能堆积标签，需要隐藏折叠栏收纳后续新页面
2. 增加访问数据统计（公开页 + 后台页），后端保留好接口供后续页面复用

已确认决策：

- 统计页面：**公开统计页 + 后台分析页都要**，共用同一聚合接口
- 数据粒度：**全量访问事件**（路径、时间、referer、UA 分类、匿名指纹 UV）
- 界面原则：不繁杂、有逻辑性、顶部不堆标签、用隐藏折叠栏
- 后续子项目（本轮不做）：C 友链体系（含点击排行榜）、D 留言板、E 相册、F 项目展示、G 标签聚合/订阅

## 子项目 A：导航折叠栏

- 桌面 Dock 五项主导航（首页/文章/标签/归档/关于）不变，末尾加"更多"项：
  - 点击弹出 framer-motion 上浮面板（图标网格，本轮只放"统计"，其余位置预留注释）
  - 点外部/ESC 关闭；当前路径属于面板内页面时"更多"项显示激活态
  - 激活态路径同步复用 Header 的 `astro:page-load` 监听（commit 后修复的 bug）
- 移动端 SideNav 抽屉：加"更多"分组直接列出链接（抽屉可滚动，无需折叠）

## 子项目 B：访问统计系统

### 后端（PocketBase，沿用本仓库 JSVM hook 与迁移模式）

1. **迁移 `page_views` 集合**
   - 字段：`path`(text)、`referrer`(text)、`ua_category`(select: mobile/tablet/desktop/bot)、`visitor_hash`(text)、`event`(select: pageview/link_click，默认 pageview——为子项目 C 友链排行预留)、`created`(自动)
   - 索引：`created`、`path`、`visitor_hash`
   - 规则：create 公开（经 hook 校验与限流），list 仅 admin；公开数据只走聚合接口
2. **采集接口 `POST /api/track-view`**（新 hook，仿 `login_security.pb.js` 的 realIP + 内存令牌桶）
   - 校验：path 必须是 `/` 开头的站内相对路径，长度 ≤200；referrer 长度 ≤500
   - `ua_category`：服务端按 UA 粗略分类（含 bot 识别）
   - `visitor_hash = sha256(IP + UA + 当日日期)`——不存原始 IP，日轮换无法跨天追踪
   - 限流：per-IP 内存桶 60 次/分，超限返回 429（不报错给前端）
3. **聚合接口 `GET /api/blog-stats?range=7d|30d`**（公开）
   - 返回：总访问、今日访问、UV（按 range）、热门页面 Top10、来源 Top10、每日序列
   - 只出聚合数字，绝不下发 `visitor_hash` 或任何单条记录
   - admin 会话加 `detail=1` 返回更多维度（如按 ua_category 分布）
4. **数据保留**：`cronAdd` 每日清理 90 天前记录；当前 PB 不支持 cronAdd 时降级为 track-view hook 内 1% 概率触发清理
5. **前端探针**（`BaseLayout` 内联脚本）：页面加载 + `astro:page-load` 时用 `navigator.sendBeacon` POST path/referrer；`navigator.doNotTrack === '1'` 时不上报；静默失败

### 前端页面

- **公开页 `/stats`**：React 岛屿拉聚合接口；数字卡片（复用 CountUp）+ 近 30 天趋势（自绘 SVG 柱状图，不引图表库）+ 热门页面/来源 Top10 + ParticleField 背景（延续设计系统）
- **后台页 `/admin/stats`**：AdminLayout + 同款数据 + 明细表；AdminSidebar 加导航项（author 及以上可见）
- 导航"更多"面板加入口（子项目 A 的落点）

### 明确不做

- 不引图表库；不存原始 IP；不做实时在线人数；友链点击排行留给子项目 C（`event` 字段已预留）
- 不改动现有 `posts.views` 字段逻辑

### 验证

- hook 单测：admin-auth 风格不适用（无 hook 测试框架），用 curl/Playwright 对本地 PB 实测 track-view 限流、聚合接口字段、DNT 行为
- 前端：build + check:visual 矩阵含 /stats；admin 页手动核对（需登录态）
