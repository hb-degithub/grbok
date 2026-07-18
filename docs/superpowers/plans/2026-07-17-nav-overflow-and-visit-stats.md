# 导航折叠栏 + 访问统计系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-17-nav-overflow-and-visit-stats-design.md` 实现导航"更多"折叠栏与全量访问统计系统（公开页 + 后台页 + 采集/聚合接口）。

**Architecture:** PocketBase JSVM hook（`routerAdd` 采集 + 聚合接口 + `cronAdd` 清理）+ `page_views` 集合迁移 + BaseLayout sendBeacon 探针 + 共享 StatsDashboard React 组件（public/admin 两变体）+ Header/SideNav 折叠导航。

**Tech Stack:** PocketBase 0.22/0.23 JSVM、Astro 6、React 19、framer-motion、Tailwind v4、Playwright（验证）。

## Global Constraints

- **不新增 npm 依赖**；图表用自绘 SVG。
- **隐私**：不存原始 IP；`visitor_hash = sha256(IP + UA + 当日日期)` 日轮换；`visitor_hash` 绝不出现在任何 API 响应中；探针尊重 DNT。
- **安全**：`page_views` 集合禁止直接 API 写入（createRule 拒绝，写入只能走 track-view hook）；list 仅 admin；track-view 校验 path 为站内相对路径并限流 60 次/分/IP。
- **接口预留**：`event` 字段（pageview/link_click）为后续友链排行榜保留，聚合接口当前只统计 pageview。
- **reduced-motion**：新动画全部走既有熔断体系。
- **Hook 写法**：遵循 `pb_hooks/blog_auth.pb.js`（`routerAdd(method, path, fn, $apis.bodyLimit(N))`、`e.json(status, body)`）与 `pb_hooks/login_security.pb.js`（`e.httpContext.realIP()` + header 回退、globalThis 内存令牌桶）。
- **迁移写法**：遵循 `pb_migrations/20260629003000_create_friend_links.pb.js`（`migrate((db) => {...}, (db) => {...})`、`Dao`、`Collection`、`SchemaField`）。
- **测试现实**：无单元测试框架。验证 = scratch PB（pocketbase.exe + 本仓库 pb_hooks/pb_migrations，端口 8099）curl 接口测试 + `npm run build` + check:visual。
- **git commit 需确认**：每个 Task 末尾的 commit 步骤执行前必须向用户确认。
- 代码注释跟随所在文件风格（pb_hooks 为中文注释）。

## 接口契约（跨 Task 依赖）

**`POST /api/track-view`**（Task 2 产出，Task 3 消费）
- 请求：JSON `{ "path": "/stats", "referrer": "https://...", "event": "pageview" }`（referrer/event 可省略，event 默认 pageview）
- 响应：202 `{ "ok": true }`；400 `{ "ok": false, "error": "INVALID_PATH" }`；429 `{ "ok": false, "error": "RATE_LIMITED" }`

**`GET /api/blog-stats?range=7d|30d[&detail=1]`**（Task 2 产出，Task 4/5 消费）
- range 默认 `30d`，非法值按 30d 处理
- 响应 200：
```json
{
  "range": "30d",
  "totalViews": 1234,
  "todayViews": 56,
  "uniqueVisitors": 321,
  "daily": [{ "date": "2026-07-01", "views": 40 }],
  "topPages": [{ "path": "/posts/hello", "views": 120 }],
  "topReferrers": [{ "referrer": "https://google.com", "views": 33 }]
}
```
- admin/super_admin 会话且 `detail=1` 时附加 `"detail": { "uaCategories": [{ "category": "desktop", "views": 800 }] }`

---

### Task 1: 迁移 `page_views` 集合

**Files:**
- Create: `pb_migrations/20260717120000_create_page_views.pb.js`

**Interfaces:**
- Produces: `page_views` 集合，字段 `path`/`referrer`/`ua_category`/`visitor_hash`/`event` + 自动 `created`。Task 2 的 hook 写入它。

- [ ] **Step 1: 写迁移**

创建 `pb_migrations/20260717120000_create_page_views.pb.js`（结构、辅助函数 `find`/`save`/`ensureField` 复制自 `pb_migrations/20260629003000_create_friend_links.pb.js`，保持仓库迁移风格）：

```js
migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function save(collection) {
    dao.saveCollection(collection);
    return dao.findCollectionByNameOrId(collection.name);
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  let views = find("page_views");
  if (!views) {
    views = new Collection({ name: "page_views", type: "base", system: false, schema: [] });
  }

  // 写入只能走 track-view hook（服务端 dao 绕过 API 规则）；禁止直接 API 创建/更新/删除
  views.createRule = null;
  views.updateRule = null;
  views.deleteRule = null;
  views.listRule = ADMIN_RULE; // 列表仅 admin；公开数据走 /api/blog-stats 聚合接口

  ensureField(views, { name: "path", type: "text", required: true, options: { min: 1, max: 200, pattern: "^/" } });
  ensureField(views, { name: "referrer", type: "text", required: false, options: { min: 0, max: 500, pattern: "" } });
  ensureField(views, { name: "ua_category", type: "select", required: true, options: { maxSelect: 1, values: ["mobile", "tablet", "desktop", "bot"] } });
  ensureField(views, { name: "visitor_hash", type: "text", required: true, options: { min: 1, max: 64, pattern: "" } });
  ensureField(views, { name: "event", type: "select", required: true, options: { maxSelect: 1, values: ["pageview", "link_click"] } });

  // 索引（若仓库其他迁移有 indexes 写法先例则照其风格；Collection.indexes 为 SQL 字符串数组）
  views.indexes = [
    "CREATE INDEX idx_page_views_created ON page_views (created)",
    "CREATE INDEX idx_page_views_path ON page_views (path)",
    "CREATE INDEX idx_page_views_visitor_hash ON page_views (visitor_hash)",
  ];

  save(views);
}, (db) => {
  const dao = new Dao(db);
  try {
    const views = dao.findCollectionByNameOrId("page_views");
    dao.deleteCollection(views);
  } catch (_) {}
});
```

注意：先 `grep -l "indexes" pb_migrations/` 看仓库是否已有 indexes 写法先例，有则对齐风格，没有就按上面写法；`created` 字段由 PB 自动生成，无需声明。

- [ ] **Step 2: 用 scratch PB 验证迁移可应用**

```bash
mkdir -p /tmp/pb-stats-test && cp pb_local/pb/pocketbase.exe /tmp/pb-stats-test/ && cp -r pb_migrations /tmp/pb-stats-test/
cd /tmp/pb-stats-test && ./pocketbase.exe migrate up
```

预期：输出含 `20260717120000_create_page_views.pb.js` 应用成功，无报错。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add pb_migrations/20260717120000_create_page_views.pb.js
git commit -m "feat(pb): add page_views collection for visit stats"
```

---

### Task 2: 统计 hook（track-view 采集 + blog-stats 聚合 + cron 清理）

**Files:**
- Create: `pb_hooks/stats_track.pb.js`

**Interfaces:**
- Consumes: Task 1 的 `page_views` 集合
- Produces: 全局约束节"接口契约"中的两个端点。Task 3 探针 POST track-view；Task 4/5 StatsDashboard GET blog-stats。

- [ ] **Step 1: 写 hook**

创建 `pb_hooks/stats_track.pb.js`。要点：

- 文件结构与限流器复制 `pb_hooks/login_security.pb.js` 的模式（IIFE 包裹、`getClientIP` 用 `e.httpContext.realIP()` + header 回退、globalThis 内存令牌桶 + 定期清理）
- body 解析参考 `login_security.pb.js` 的 `getEmailFromBody`：`e.request?.body` 字符串 JSON.parse，失败按 `{}` 处理
- sha256：优先 `$security.sha256(text)`（PB JSVM 提供，返回 hex）。**先在 scratch PB 上用一行 `console.log($security.sha256('x'))` 的临时 hook 或现有 hook 日志验证可用性**；若不可用，降级为文件内实现 FNV-1a 64 位哈希（约 15 行纯 JS，对 UV 计数精度足够），并在注释中说明
- 聚合查询：`$app.dao().db().newQuery('SELECT ... ') .bind({...}).all(rows)`，rows 用 `arrayOf(new DynamicModel({...}))` 构造；查询参数访问：`e.request.url.query().get('range')`。**这两个 JSVM API 先在 scratch PB 上验证再定稿**；若 `db().newQuery` 不可用，降级为 `dao.findRecordsByFilter('page_views', 'created >= {:from}', '-created', 5000, 0)` 取回后在 JS 内聚合（90 天保留期下单表量级可接受）
- admin 判定（detail=1 用）：`e.auth` 存在且 `e.auth.getString('role')` 为 `admin` 或 `super_admin`
- cronAdd 用法参考 `pb_hooks/blog_auth.pb.js:87`

完整实现：

```js
(function () {
/// <reference path="../pb_data/types.d.ts" />

// 访问统计：track-view 采集 + blog-stats 聚合 + 每日清理 90 天前数据
// 隐私：不存原始 IP，visitor_hash = sha256(IP + UA + 当日日期) 日轮换；
// 任何端点都不返回 visitor_hash 或单条记录，只出聚合数字。

const RATE_LIMIT_PER_MIN = 60;
const WINDOW_MS = 60 * 1000;
const RETENTION_DAYS = 90;

const rateBuckets = globalThis.statsRateBuckets || (globalThis.statsRateBuckets = {});
let lastCleanup = Date.now();

function maybeCleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  for (const key of Object.keys(rateBuckets)) {
    const bucket = rateBuckets[key];
    if (!bucket || bucket.length === 0 || now - bucket[bucket.length - 1] > WINDOW_MS) {
      delete rateBuckets[key];
    }
  }
}

function isRateLimited(key, maxAttempts) {
  maybeCleanupBuckets();
  const now = Date.now();
  const bucket = rateBuckets[key] || (rateBuckets[key] = []);
  while (bucket.length > 0 && now - bucket[0] > WINDOW_MS) bucket.shift();
  if (bucket.length >= maxAttempts) return true;
  bucket.push(now);
  return false;
}

function getHeader(e, name) {
  try {
    return e.httpContext?.request()?.header?.get(name) || '';
  } catch (_) {
    return '';
  }
}

function getClientIP(e) {
  try {
    const real = e.httpContext?.realIP?.();
    if (real && real.trim()) return real.trim();
  } catch (_) {}
  const realIP = getHeader(e, 'X-Real-IP');
  if (realIP) return realIP.trim();
  const forwarded = getHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '';
}

function readBody(e) {
  try {
    const body = e.request?.body;
    if (!body) return {};
    return JSON.parse(typeof body === 'string' ? body : JSON.stringify(body));
  } catch (_) {
    return {};
  }
}

function classifyUA(ua) {
  const s = (ua || '').toLowerCase();
  if (/bot|spider|crawl|slurp|curl|wget|python|headless|scrapy/.test(s)) return 'bot';
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobi|android|iphone|ipod/.test(s)) return 'mobile';
  return 'desktop';
}

function isValidPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false;
  if (p[0] !== '/' || p.startsWith('//')) return false;
  if (p.includes('..') || p.includes('\\')) return false;
  return true;
}

function sha256Hex(text) {
  return $security.sha256(text);
}

function todayString() {
  // 以服务器时区取当日零点，用于 visitor_hash 日轮换
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function rangeStart(range) {
  const days = range === '7d' ? 7 : 30;
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function queryRows(sql, params, shape) {
  const rows = arrayOf(new DynamicModel(shape));
  $app.dao().db().newQuery(sql).bind(params).all(rows);
  return rows;
}

function isAdminRequest(e) {
  try {
    const role = e.auth ? e.auth.getString('role') : '';
    return role === 'admin' || role === 'super_admin';
  } catch (_) {
    return false;
  }
}

// ---- POST /api/track-view ----
routerAdd('POST', '/api/track-view', function (e) {
  const ip = getClientIP(e) || 'unknown';
  if (isRateLimited('tv:' + ip, RATE_LIMIT_PER_MIN)) {
    return e.json(429, { ok: false, error: 'RATE_LIMITED' });
  }

  const body = readBody(e);
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!isValidPath(path)) {
    return e.json(400, { ok: false, error: 'INVALID_PATH' });
  }

  let referrer = typeof body.referrer === 'string' ? body.referrer.trim() : '';
  if (referrer.length > 500) referrer = referrer.slice(0, 500);

  const event = body.event === 'link_click' ? 'link_click' : 'pageview';
  const ua = getHeader(e, 'User-Agent');
  const category = classifyUA(ua);
  const visitorHash = sha256Hex(ip + '|' + ua + '|' + todayString());

  try {
    const collection = $app.dao().findCollectionByNameOrId('page_views');
    const record = new Record(collection);
    record.set('path', path);
    record.set('referrer', referrer);
    record.set('ua_category', category);
    record.set('visitor_hash', visitorHash);
    record.set('event', event);
    $app.dao().saveRecord(record);
  } catch (error) {
    console.error('[stats] track-view save failed: ' + error);
    return e.json(500, { ok: false, error: 'SAVE_FAILED' });
  }

  return e.json(202, { ok: true });
}, $apis.bodyLimit(4096));

// ---- GET /api/blog-stats ----
routerAdd('GET', '/api/blog-stats', function (e) {
  const range = e.request.url.query().get('range') === '7d' ? '7d' : '30d';
  const from = rangeStart(range);
  const todayFrom = todayString() + ' 00:00:00';

  try {
    const totalRows = queryRows(
      'SELECT COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from}',
      { ev: 'pageview', from }, { c: 0 });
    const todayRows = queryRows(
      'SELECT COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from}',
      { ev: 'pageview', from: todayFrom }, { c: 0 });
    const uvRows = queryRows(
      'SELECT COUNT(DISTINCT visitor_hash) AS c FROM page_views WHERE event = {:ev} AND created >= {:from}',
      { ev: 'pageview', from }, { c: 0 });

    const dailyRaw = queryRows(
      'SELECT DATE(created) AS d, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY DATE(created) ORDER BY d ASC',
      { ev: 'pageview', from }, { d: '', c: 0 });
    const topPagesRaw = queryRows(
      'SELECT path, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY path ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from }, { path: '', c: 0 });
    const topRefRaw = queryRows(
      'SELECT referrer, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND referrer != \'\' AND created >= {:from} GROUP BY referrer ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from }, { referrer: '', c: 0 });

    const response = {
      range,
      totalViews: Number(totalRows[0]?.c || 0),
      todayViews: Number(todayRows[0]?.c || 0),
      uniqueVisitors: Number(uvRows[0]?.c || 0),
      daily: dailyRaw.map((r) => ({ date: String(r.d), views: Number(r.c) })),
      topPages: topPagesRaw.map((r) => ({ path: String(r.path), views: Number(r.c) })),
      topReferrers: topRefRaw.map((r) => ({ referrer: String(r.referrer), views: Number(r.c) })),
    };

    // admin 会话 + detail=1：附加 UA 分类分布
    const wantDetail = e.request.url.query().get('detail') === '1';
    if (wantDetail && isAdminRequest(e)) {
      const uaRaw = queryRows(
        'SELECT ua_category, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY ua_category ORDER BY c DESC',
        { ev: 'pageview', from }, { ua_category: '', c: 0 });
      response.detail = {
        uaCategories: uaRaw.map((r) => ({ category: String(r.ua_category), views: Number(r.c) })),
      };
    }

    return e.json(200, response);
  } catch (error) {
    console.error('[stats] blog-stats query failed: ' + error);
    return e.json(500, { ok: false, error: 'QUERY_FAILED' });
  }
}, $apis.bodyLimit(4096));

// ---- 每日清理 90 天前数据 ----
cronAdd('page-views-retention-cleanup', '17 3 * * *', function () {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  try {
    $app.dao().db().newQuery('DELETE FROM page_views WHERE created < {:cutoff}')
      .bind({ cutoff }).execute();
  } catch (error) {
    console.error('[stats] retention cleanup failed: ' + error);
  }
});
})();
```

- [ ] **Step 2: scratch PB 验证（迁移 + 端点契约）**

```bash
mkdir -p /tmp/pb-stats-test && cp pb_local/pb/pocketbase.exe /tmp/pb-stats-test/
cp -r pb_migrations pb_hooks /tmp/pb-stats-test/
cd /tmp/pb-stats-test && ./pocketbase.exe serve --http=127.0.0.1:8099 &
sleep 3
```

依次验证并记录输出：

```bash
# 合法上报 → 202 {"ok":true}
curl -s -X POST http://127.0.0.1:8099/api/track-view -H "Content-Type: application/json" -d '{"path":"/","referrer":"https://google.com"}'
# 非法 path → 400 INVALID_PATH
curl -s -X POST http://127.0.0.1:8099/api/track-view -H "Content-Type: application/json" -d '{"path":"https://evil.com"}'
# 聚合接口字段齐全、无 visitor_hash
curl -s "http://127.0.0.1:8099/api/blog-stats?range=30d"
# detail=1 匿名 → 响应无 detail 字段
curl -s "http://127.0.0.1:8099/api/blog-stats?range=30d&detail=1"
# 直接 API 创建 page_views 必须被拒绝（403/400）
curl -s -X POST http://127.0.0.1:8099/api/collections/page_views/records -H "Content-Type: application/json" -d '{"path":"/x","ua_category":"desktop","visitor_hash":"a","event":"pageview"}'
# 限流：61 次连发应出现 429（用循环）
for i in $(seq 1 61); do curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8099/api/track-view -H "Content-Type: application/json" -d '{"path":"/"}'; done
```

预期：202 / 400 / 200(字段齐全) / 200(无 detail) / 403或400 / 序列末尾出现 429。

`$security.sha256` 或 `db().newQuery` 若报错，按 Step 1 注明的降级方案修正后重测。测试完 `pkill -f "pocketbase.exe serve"`。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add pb_hooks/stats_track.pb.js
git commit -m "feat(pb): add track-view ingest and blog-stats aggregate endpoints"
```

---

### Task 3: 前端访问探针（BaseLayout sendBeacon）

**Files:**
- Modify: `astro/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: Task 2 的 `POST {PB}/api/track-view`（body `{ path, referrer }`，202 响应）
- Produces: 全站每次页面浏览（含 ClientRouter 客户端导航）自动上报。

- [ ] **Step 1: BaseLayout 加探针脚本**

`astro/src/layouts/BaseLayout.astro` 中，`</body>` 之前（`<ToastContainer client:load />` 之后）加：

```astro
<script define:vars={{ pbBase: import.meta.env.PUBLIC_POCKETBASE_URL || '' }}>
  // 访问统计探针：页面浏览（含客户端导航）通过 sendBeacon 上报。
  // 尊重 DNT；静默失败绝不影响页面；guard 防止 ClientRouter 重复挂监听。
  (() => {
    if (!pbBase) return;
    const send = () => {
      try {
        if (navigator.doNotTrack === '1') return;
        const body = JSON.stringify({ path: location.pathname, referrer: document.referrer || '' });
        navigator.sendBeacon(`${pbBase}/api/track-view`, new Blob([body], { type: 'application/json' }));
      } catch (_) {}
    };
    send();
    if (!window.__pvBeaconBound) {
      window.__pvBeaconBound = true;
      document.addEventListener('astro:page-load', send);
    }
  })();
</script>
```

注意：`define:vars` 使脚本内联且不打包，每次页面切换会重新执行——`send()` 因此每次导航都会触发一次（正确行为），监听器用 `window.__pvBeaconBound` 防重复绑定。

- [ ] **Step 2: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add astro/src/layouts/BaseLayout.astro
git commit -m "feat(astro): add page-view beacon to BaseLayout"
```

---

### Task 4: 公开统计页 `/stats` + StatsDashboard 组件

**Files:**
- Create: `astro/src/components/stats/StatsDashboard.tsx`
- Create: `astro/src/pages/stats.astro`

**Interfaces:**
- Consumes: Task 2 的 `GET {PB}/api/blog-stats?range=30d`（响应契约见全局约束节）；`astro/src/components/reactbits/CountUp`（默认导出，props `{ to: number, duration?: number }`）；`astro/src/components/effects/ParticleField`（Task 6 批次已用的背景组件）；`astro/src/components/ui/ScrollReveal`
- Produces: `StatsDashboard`（默认导出，props `{ variant?: 'public' | 'admin' }`）——Task 5 后台页以 `variant="admin"` 复用。

- [ ] **Step 1: 写 StatsDashboard 组件**

创建 `astro/src/components/stats/StatsDashboard.tsx`：

```tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import CountUp from '../reactbits/CountUp';
import { fadeUp, staggerContainer } from '../../lib/motion';

interface StatsData {
  range: string;
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  daily: Array<{ date: string; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
  detail?: { uaCategories: Array<{ category: string; views: number }> };
}

interface StatsDashboardProps {
  variant?: 'public' | 'admin';
}

const PB_URL = import.meta.env.PUBLIC_POCKETBASE_URL || '';

const CATEGORY_LABELS: Record<string, string> = {
  desktop: '桌面',
  mobile: '手机',
  tablet: '平板',
  bot: '爬虫',
};

export default function StatsDashboard({ variant = 'public' }: StatsDashboardProps) {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!PB_URL) {
      setError(true);
      return;
    }
    const url = `${PB_URL}/api/blog-stats?range=30d${variant === 'admin' ? '&detail=1' : ''}`;
    fetch(url, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => setData(json as StatsData))
      .catch(() => setError(true));
  }, [variant]);

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        统计数据暂时不可用，请稍后再试。
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: '总访问量', value: data.totalViews },
    { label: '今日访问', value: data.todayViews },
    { label: '独立访客（30天）', value: data.uniqueVisitors },
    { label: '统计天数', value: data.daily.length },
  ];
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.views));

  return (
    <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="visible" className="space-y-6">
      {/* 数字卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <motion.div
            key={card.label}
            variants={fadeUp}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-3xl font-black text-zinc-950 dark:text-zinc-50">
              <CountUp to={card.value} duration={1.2} />
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* 30 天趋势（自绘 SVG 柱状图） */}
      <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">近 30 天访问趋势</h3>
        {data.daily.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">暂无数据</p>
        ) : (
          <svg viewBox={`0 0 ${data.daily.length * 12} 120`} className="h-28 w-full" role="img" aria-label="近30天每日访问量柱状图">
            {data.daily.map((d, i) => {
              const h = Math.max(2, Math.round((d.views / maxDaily) * 100));
              return (
                <rect
                  key={d.date}
                  x={i * 12 + 1}
                  y={110 - h}
                  width={10}
                  height={h}
                  rx={2}
                  className="fill-teal-500/70 transition-colors hover:fill-teal-500 dark:fill-teal-400/70 dark:hover:fill-teal-400"
                >
                  <title>{`${d.date}：${d.views} 次访问`}</title>
                </rect>
              );
            })}
          </svg>
        )}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 热门页面 */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">热门页面 Top 10</h3>
          <ol className="space-y-2 text-sm">
            {data.topPages.length === 0 && <li className="text-zinc-400">暂无数据</li>}
            {data.topPages.map((p, i) => (
              <li key={p.path} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                <a href={p.path} className="min-w-0 flex-1 truncate text-zinc-700 no-underline hover:text-teal-600 dark:text-zinc-300 dark:hover:text-teal-400">{p.path}</a>
                <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{p.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* 来源 */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">访问来源 Top 10</h3>
          <ol className="space-y-2 text-sm">
            {data.topReferrers.length === 0 && <li className="text-zinc-400">暂无数据</li>}
            {data.topReferrers.map((r, i) => (
              <li key={r.referrer} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{r.referrer}</span>
                <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>
      </div>

      {/* admin 变体：UA 分类分布 */}
      {variant === 'admin' && data.detail && (
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">设备分布（30 天）</h3>
          <div className="flex flex-wrap gap-3">
            {data.detail.uaCategories.map((c) => (
              <span key={c.category} className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {CATEGORY_LABELS[c.category] || c.category} · {c.views}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: 写 /stats 页面**

创建 `astro/src/pages/stats.astro`（延续 Task 6 批次其他页面的模式：ParticleField 背景 + `relative z-10` 内容层 + ScrollReveal 头部）：

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ParticleField from '../components/effects/ParticleField';
import ScrollReveal from '../components/ui/ScrollReveal';
import StatsDashboard from '../components/stats/StatsDashboard';
---

<BaseLayout title="访问统计" description="全站访问数据与热门内容">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <section class="relative z-10 mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 lg:px-10">
    <div class="mb-10">
      <ScrollReveal client:visible>
        <div class="mb-4 flex items-center gap-3">
          <span class="h-px w-8 bg-zinc-400 dark:bg-zinc-500"></span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Stats</span>
        </div>
        <h1 class="text-4xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">访问统计</h1>
        <p class="mt-3 max-w-xl text-zinc-500 dark:text-zinc-400">全站访问量、独立访客与热门内容。数据匿名采集，不含任何个人信息。</p>
      </ScrollReveal>
    </div>
    <StatsDashboard client:load variant="public" />
  </section>
</BaseLayout>
```

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功，dist 含 `/stats/index.html`。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/components/stats/StatsDashboard.tsx astro/src/pages/stats.astro
git commit -m "feat(astro): public stats page with StatsDashboard"
```

---

### Task 5: 后台统计页 `/admin/stats` + 侧边导航项

**Files:**
- Create: `astro/src/pages/admin/stats/index.astro`
- Modify: `astro/src/components/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: Task 4 的 `StatsDashboard`（`variant="admin"`）；AdminLayout（`title`、`requiredRole` props）
- Produces: `/admin/stats` 路由；AdminSidebar「主控台」分组新增「统计」项。

- [ ] **Step 1: 写后台页面**

参考 `astro/src/pages/admin/audit/index.astro` 的现有结构（先读一个现有 admin 页确认写法），创建 `astro/src/pages/admin/stats/index.astro`：

```astro
---
import AdminLayout from '../../../layouts/AdminLayout.astro';
import StatsDashboard from '../../../components/stats/StatsDashboard';
---

<AdminLayout title="访问统计" requiredRole="author">
  <StatsDashboard client:only="react" variant="admin" />
</AdminLayout>
```

（若现有 admin 页用法不同，以现有页为准对齐。）

- [ ] **Step 2: AdminSidebar 加导航项**

`astro/src/components/admin/AdminSidebar.tsx` 的 `navItems` 数组中，`/admin`（仪表盘）项之后插入：

```ts
  { href: '/admin/stats', label: '统计', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6', section: '主控台', requiredRole: 'author', hint: '访问' },
```

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/pages/admin/stats/ astro/src/components/admin/AdminSidebar.tsx
git commit -m "feat(astro): admin stats page and sidebar entry"
```

---

### Task 6: 导航折叠栏（Header「更多」下拉 + SideNav「更多功能」分组）

**Files:**
- Modify: `astro/src/components/layout/Header.tsx`
- Modify: `astro/src/components/layout/SideNav.tsx`

**Interfaces:**
- Consumes: `/stats` 路由（Task 4）；Header 现有的 theme 下拉模式（`themeMenuOpen`/`menuRef`/AnimatePresence popover，`Header.tsx:213-250`）与 `isActive` 辅助函数；SideNav 的 `mainNavItems`/`secondaryNavItems` 分组结构（`SideNav.tsx:14-22, 195-250`）
- Produces: Dock「更多」项与下拉面板；SideNav「更多功能」分组。后续子项目（友链/留言板等）向 `MORE_LINKS` 数组追加条目即可，无需再改结构。

- [ ] **Step 1: Header 加「更多」下拉**

`astro/src/components/layout/Header.tsx`：

1. `navItems` 常量后加：

```ts
// 「更多」折叠栏条目：后续子项目（友链/留言板/相册/项目/订阅）逐个追加到这里
const MORE_LINKS = [
  { href: '/stats', label: '访问统计', description: '全站访问数据与热门内容', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6' },
];
```

2. 状态区加（`themeMenuOpen` 旁）：

```ts
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
```

3. `menuRef` 旁加：

```ts
  const moreMenuRef = useRef<HTMLDivElement>(null);
```

4. 点外部关闭的 effect（现有 themeMenuOpen 那个，约 80-100 行）改为同时处理两个菜单（参照现有逻辑，把另一个 ref/state 纳入），并保证开「更多」时关「主题」、开「主题」时关「更多」。

5. `dockItems` useMemo 中，主题项之后加：

```ts
      {
        icon: <Icon d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />,
        label: '更多',
        onClick: () => { setMoreMenuOpen((open) => !open); setThemeMenuOpen(false); },
        hasPopup: 'menu',
        expanded: moreMenuOpen,
        active: MORE_LINKS.some((link) => isActive(link.href)),
      },
```

同时把主题项的 onClick 改为 `{ setThemeMenuOpen((open) => !open); setMoreMenuOpen(false); }`，并把 `moreMenuOpen` 加入 useMemo 依赖数组。

6. 主题下拉 `</AnimatePresence>` 之后，复刻同样的 popover 结构渲染「更多」面板（`ref={moreMenuRef}`、`role="menu"`、同样的定位与样式类），内容为 `MORE_LINKS.map` 的链接行（`<a>`，`role="menuitem"`，点击 `setMoreMenuOpen(false)`；图标 + label + description 两行结构，样式对齐主题项的 button 行）。

- [ ] **Step 2: SideNav 加「更多功能」分组**

`astro/src/components/layout/SideNav.tsx`：

1. `mainNavItems` 后加：

```ts
const moreNavItems = [
  { href: '/stats', label: '访问统计', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6' },
];
```

2. 「其他」分组的 `motion.div` 之前，插入一个同样结构的 `motion.div` 分组：标题「更多功能」，`moreNavItems.map` 渲染与主导航相同的链接行（复用现有 `staggerVariants`、`isActive`、`handleLinkClick` 逻辑）。

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/components/layout/Header.tsx astro/src/components/layout/SideNav.tsx
git commit -m "feat(astro): overflow 'More' menu in dock and side nav"
```

---

### Task 7: 全量验证（scratch PB 端到端 + 视觉矩阵 + Header 修复一并提交）

**Files:**
- Modify: `astro/scripts/visual-check.mjs`（ROUTES 加 `/stats`）

**Interfaces:**
- Consumes: Tasks 1-6 全部产物；工作区中尚未提交的 Header `astro:page-load` 修复（`Header.tsx:65-80`）

- [ ] **Step 1: ROUTES 加 /stats**

`astro/scripts/visual-check.mjs` 的 `ROUTES` 数组 `'/login'` 前插入 `'/stats'`。

- [ ] **Step 2: scratch PB 端到端**

```bash
mkdir -p /tmp/pb-stats-e2e && cp pb_local/pb/pocketbase.exe /tmp/pb-stats-e2e/
cp -r pb_migrations pb_hooks /tmp/pb-stats-e2e/
cd /tmp/pb-stats-e2e && ./pocketbase.exe serve --http=127.0.0.1:8099 &
sleep 3
# 造 20 条测试数据（不同路径/来源/日期）
for p in / /posts /tags /stats; do for i in 1 2 3 4 5; do curl -s -o /dev/null -X POST http://127.0.0.1:8099/api/track-view -H "Content-Type: application/json" -d "{\"path\":\"$p\",\"referrer\":\"https://google.com\"}"; done; done
curl -s "http://127.0.0.1:8099/api/blog-stats?range=30d" | head -c 400
```

预期：totalViews ≥ 20，topPages 非空。

- [ ] **Step 3: 用 scratch PB 做全站构建与视检**

```bash
cd astro && PUBLIC_POCKETBASE_URL=http://127.0.0.1:8099 npm run build
cd astro && (npm run preview > /tmp/astro-preview.log 2>&1 &) && sleep 4 && npm run check:visual; pkill -f "astro preview"
```

预期：check:visual 全部 PASS（/stats 页面正常渲染、无控制台错误、无溢出）。`/stats` 截图人工过目：数字卡片显示 scratch PB 的数据（totalViews ≥ 20），柱状图非空。

- [ ] **Step 4: Commit（需用户确认）——含此前未提交的 Header 激活态修复**

```bash
git add astro/scripts/visual-check.mjs astro/src/components/layout/Header.tsx
git commit -m "fix(astro): sync dock active state on client navigation; add /stats to visual matrix"
```

---

## Self-Review 记录

- **Spec 覆盖**：迁移/track-view/blog-stats/cron 清理（Task 1-2）→ spec 后端节；探针（Task 3）→ spec 前端探针节；/stats 与 /admin/stats（Task 4-5）→ spec 前端页面节；导航折叠（Task 6）→ 子项目 A；验证（Task 7）→ spec 验证节。接口预留（event 字段）落实在 Task 1-2。
- **风险标注**：`$security.sha256`、`db().newQuery`、`DynamicModel` 三个 JSVM API 存在版本差异风险，Task 2 Step 2 要求先在 scratch PB 验证并给了降级方案（FNV-1a / findRecordsByFilter + JS 聚合）。
- **类型一致性**：blog-stats 响应字段名（totalViews/todayViews/uniqueVisitors/daily/topPages/topReferrers/detail.uaCategories）在 Task 2 产出与 Task 4 消费的 `StatsData` 接口中逐字一致；`MORE_LINKS` 的 `/stats` 与 Task 4 路由一致。
- **环境注意**：用户日常开发 PB（pb_local/pb/pocketbase.exe）不加载 hooks；生产经 docker 卷挂载 pb_hooks。本计划的验证全部用独立 scratch PB，不碰用户 dev 数据。
