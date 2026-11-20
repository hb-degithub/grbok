/**
 * Task D 阅读路径验收 · SSR 侧 PocketBase 夹具（仅测试用，不进入生产）。
 *
 * 为什么需要它：
 *   `src/pages/posts/[slug].astro` 的正文、作者回退与 404 分支都来自 SSR 取数。
 *   如果 PB 不可达，详情页永远只能渲染「文章不存在」，那样的 404 不能证明
 *   「已发布文章可读 / 草稿不可读」。这里用一个只读的本地 HTTP 进程补齐
 *   SSR 依赖的两条 JSON 接口（+ 目录页的 tags），让 fixture 数据成为唯一数据源。
 *
 * 边界：
 * - 只服务 GET：posts（filter 解析 slug + status="published"）、public authors、
 *   tags、announcements（布局预取）、/api/realtime（真实 SSE 传输，避免 SDK
 *   反复重连把 console.error 噪音带进断言）。
 * - 浏览器侧的数据面（settings / public_comments / posts 列表）由
 *   reading-populated.spec.ts 的 route mock 提供；本进程只负责 SSR 与 SSE 传输。
 * - `/__requests` 暴露请求日志，供 Playwright 证明 SSR 真的走了这些分支
 *   （尤其是 expand=null 时的 /api/public/authors/:id 回退）。
 *
 * 启动：READING_FIXTURE_PORT=8199 node e2e/sci-fi-site/reading-populated-pb-fixture.mjs
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HOST = '127.0.0.1';
const LOG_DIR = path.join(import.meta.dirname, '..', '..', 'tmp', 'reading-populated');
const LOG_FILE = path.join(LOG_DIR, 'requests.ndjson');
mkdirSync(LOG_DIR, { recursive: true });
writeFileSync(LOG_FILE, '');
const PORT = Number(process.env.READING_FIXTURE_PORT ?? 8199);

const dataset = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'reading-populated-dataset.json'), 'utf8'),
);

/** 供 /__requests 读取；只记路径+查询，不记 body。 */
const requestLog = [];
/** 未被夹具覆盖的路径：测试据此证明没有「静默 404 的数据请求」。 */
const unmatchedRequests = [];
const sseClients = new Set();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': '*',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function listResponse(items, page = 1, perPage = 20) {
  return {
    page,
    perPage,
    totalItems: items.length,
    totalPages: items.length ? Math.max(1, Math.ceil(items.length / perPage)) : 0,
    items,
  };
}

/** 从 PocketBase filter 里取 `key="value"`（夹具只接受这一种写法）。 */
function filterValue(filter, key) {
  const match = filter.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`));
  return match?.[1] ?? null;
}

function sseHandler(req, res) {
  res.writeHead(200, {
    ...CORS,
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // res.socket 在 SSE 期间不能因为 keep-alive 超时被 Node 关闭。
  res.socket?.setTimeout(0);
  res.socket?.setKeepAlive(true, 5000);

  const clientId = 'reading-fixture-client';
  // PB JS SDK 用 EventSource 的 lastEventId 作为 clientId，因此 id: 必须有。
  res.write(`id: ${clientId}\nevent: PB_CONNECT\ndata: {"clientId":"${clientId}"}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* connection already gone */
    }
  }, 2000);
  sseClients.add(res);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (pathname === '/health') {
    sendJson(res, 200, { ok: true, mode: 'reading-populated-fixture', port: PORT });
    return;
  }

  if (pathname === '/__requests') {
    sendJson(res, 200, {
      count: requestLog.length,
      requests: requestLog,
      unmatched: unmatchedRequests,
    });
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    method,
    url: `${pathname}${url.search}`,
    referer: req.headers.referer ?? '',
    ua: req.headers['user-agent'] ?? '',
  };
  requestLog.push(entry);
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

  // 布局在 SSR 阶段预取公告；夹具没有公告。
  if (pathname === '/api/collections/announcements/records') {
    sendJson(res, 200, listResponse([], 1, 3));
    return;
  }

  // SSR 详情页唯一的数据入口：filter = slug="..." && status="published"。
  if (pathname === '/api/collections/posts/records') {
    const filter = url.searchParams.get('filter') ?? '';
    const slug = filterValue(filter, 'slug');
    const publishedOnly = /status\s*=\s*"published"/.test(filter);
    const items =
      publishedOnly && slug === dataset.publishedPost.slug ? [dataset.publishedPost] : [];
    sendJson(res, 200, listResponse(items, 1, 1));
    return;
  }

  // 作者回退：expand=null 时详情页会请求这里。
  const authorMatch = pathname.match(/^\/api\/public\/authors\/([^/]+)$/);
  if (authorMatch) {
    const id = decodeURIComponent(authorMatch[1]);
    if (id === dataset.author.id) {
      sendJson(res, 200, { name: dataset.author.name, avatar: dataset.author.avatar });
    } else {
      sendJson(res, 404, { code: 404, message: 'The requested resource was not found.' });
    }
    return;
  }

  // 标签页 SSR：filter = slug="..."。
  if (pathname === '/api/collections/tags/records') {
    const slug = filterValue(url.searchParams.get('filter') ?? '', 'slug');
    sendJson(res, 200, listResponse(slug === dataset.tag.slug ? [dataset.tag] : [], 1, 20));
    return;
  }

  // 实时评论：只提供传输通道。浏览器侧 route mock 不拦这个路径，
  // 由本进程真实维持 SSE，避免 SDK 断线重连产生非预期 console.error。
  if (pathname === '/api/realtime' && method === 'GET') {
    sseHandler(req, res);
    return;
  }
  if (pathname === '/api/realtime' && method === 'POST') {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    res.end('{}');
    return;
  }

  unmatchedRequests.push({
    at: new Date().toISOString(),
    url: `${method} ${pathname}${url.search}`,
    referer: req.headers.referer ?? '',
    ua: req.headers['user-agent'] ?? '',
  });
  sendJson(res, 404, {
    code: 404,
    message: `reading fixture has no route for ${method} ${pathname}`,
  });
}

const server = createServer(handle);
// SSE 长连接不应被 keep-alive 超时打断。
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[reading-fixture] port ${PORT} already in use; refusing to reuse it.`);
  } else {
    console.error('[reading-fixture] server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[reading-fixture] listening on http://${HOST}:${PORT}`);
  console.log(`[reading-fixture] published ${dataset.publishedPost.slug}; draft ${dataset.draftPost.slug}`);
});

function shutdown() {
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
