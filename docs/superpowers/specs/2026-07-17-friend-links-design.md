# 友链体系设计（子项目 C）+ 后端接口契约

日期：2026-07-17
状态：已批准（用户"继续"确认）

## 范围

- 前端（本次实施）：`/links` 友链页（卡片网格 + 点击排行区 + 申请说明）、Footer 友链行、导航入口（Dock 更多 / SideNav 更多功能）
- 后端（用户实现，本文件即契约）：`track-view` 扩展 `link_click`/`target`、`GET /api/friend-link-stats` 聚合接口、`page_views` 加 `target` 字段

已确认决策：

- 排行榜**嵌在友链页内**（接口未就绪时显示"数据积累中"空态）
- 申请入口用**静态说明 + mailto**，不做表单
- 工作模式：只做前端，后端以接口契约保留

## 前端设计

### `/links` 友链页（`astro/src/pages/links.astro`）

延续设计系统：ParticleField 背景（`hidden lg:block`）+ `relative z-10` 内容 + ScrollReveal 头部（kicker "Links" + h1 友情链接 + 说明文案）。

三个区块，均为 React 岛屿：

1. **友链卡片网格**（`components/links/FriendLinksGrid.tsx`，client:load）
   - 数据：`getPocketBase().collection('friend_links').getList(1, 50, { sort: 'sort_order,-created' })`，过滤 `status === 'show'`（集合规则已允许公开读取 show 记录，无需后端改动）
   - 卡片：avatar（无 avatar 显示首字母色块）+ name + description（截断）+ 域名（`new URL(url).hostname`）
   - 交互：hover 上浮 + 边框 teal（复用设计系统）；点击时先 `trackLinkClick(url)`（sendBeacon，不阻塞）再 `target="_blank"` 打开
   - URL 安全校验复用现有 `isSafeLinkUrl` 逻辑（http/https 才渲染为链接）
2. **热门友链排行**（`components/links/FriendLinkLeaderboard.tsx`，client:load）
   - 数据：`fetch(${PB}/api/friend-link-stats)` → `{ top: [{ target, clicks }] }`
   - 渲染：Top10 列表，前三名金/银/铜圆点标记，名称用卡片网格数据按 URL 匹配（匹配不到显示 hostname），右侧点击数
   - 空态：接口 404/报错/空数组 → "排行数据积累中"（不报错、不阻塞页面）
3. **申请友链**（静态区，写在 links.astro 模板内）
   - 说明文案 + `mailto:670486183@qq.com`，注明格式：站名 / URL / 一句话简介

### Footer 友链行（`components/links/FooterFriendLinks.tsx` + Footer.astro）

- 紧凑单行：`友情链接：` + 前 10 个友链的文本链接（间隔分隔），超过 10 个末尾加"全部 →"跳 `/links`
- 位置：Footer 主行与备案行之间，`client:visible`
- 无数据时不渲染任何内容（避免空标题）

### 导航入口

- `Header.tsx` 的 `MORE_LINKS` 追加 `{ href: '/links', label: '友情链接', description: '朋友们的站点', icon: <链环图标> }`
- `SideNav.tsx` 的 `moreNavItems` 追加 `/links`

### 点击上报（`astro/src/lib/track.ts`）

```ts
export function trackLinkClick(target: string): void
```

- `navigator.doNotTrack === '1'` 直接返回；`PUBLIC_POCKETBASE_URL` 为空直接返回
- `navigator.sendBeacon(${PB}/api/track-view, Blob(json({ path: location.pathname, event: 'link_click', target }), application/json))`
- 全函数 try/catch 静默

## 后端接口契约（用户实现）

### 1. `page_views` 集合加字段（小迁移）

- `target`：text，可选，max 500。仅 `event = 'link_click'` 的行使用。

### 2. `POST /api/track-view` 扩展

现有契约不变，追加：

- 当 `event === 'link_click'`：
  - 必须携带 `target`，且必须是 `http://` 或 `https://` 开头的 URL，长度 ≤500；不满足返回 `400 { "ok": false, "error": "INVALID_TARGET" }`
  - `path` 语义 = 点击发生的页面路径（沿用现有 path 校验）
  - `target` 原样存储（不归一化，排行榜按完整 URL 聚合）
- 现有 `pageview` 行为、`link_click` 白名单（已预留）不变；/admin|/api|/_ 路径跳过规则对 `link_click` 同样生效

### 3. `GET /api/friend-link-stats`（公开，新增）

- 响应 200：
```json
{
  "range": "30d",
  "top": [
    { "target": "https://example.com", "clicks": 42 }
  ]
}
```
- 只统计 `event = 'link_click'` 且 `target != ''` 的行，近 30 天，按 clicks 降序，Top 10
- 纯聚合，不返回任何 `visitor_hash`、IP 或单条记录
- 建议与 blog-stats 同款限流/缓存策略

## 明确不做

- 不做友链申请表单（mailto 静态说明）
- 不做友链可用性巡检（死链检测）
- 后端实现不属于本次工作（契约见上）

## 验证

- `npm run build` 通过；check:visual 矩阵加 `/links`
- 排行区空态（接口 404 时）截图确认不报错
- 卡片点击（Playwright 探针）：确认打开新标签且触发一次 sendBeacon（抓请求验证 body 含 `event: 'link_click'` 与 target）
