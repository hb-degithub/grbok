'use strict';

// 访问统计共享逻辑：track-view 采集 + blog-stats 聚合 + 90 天保留清理。
// 隐私：不存原始 IP，visitor_hash = sha256(IP + UA + 当日日期) 日轮换；
// 任何端点都不返回 visitor_hash 或单条记录，只出聚合数字。
//
// 为什么逻辑在 lib 里：PB 0.22 JSVM 的 routerAdd/cronAdd 回调是按源码字符串
// 在每个请求的 goja runtime 里重新 eval 的，拿不到注册处 IIFE 的闭包变量，
// 所以 handler 必须自包含（同 blog_auth.pb.js + lib/auth_facade.js 模式）。
//
// 版本说明（PB 0.22.21，已在 scratch PB 探针验证）：
// - routerAdd 回调收到的是 echo.Context：e.realIP()、e.request().header.get()、
//   e.queryParam()、e.json()；body 用 readerToString(e.request().body, max)。
// - $security.sha256 可用，无需 FNV-1a 降级。
// - $app.dao().db().newQuery(...).bind(...).all(arrayOf(new DynamicModel({...})))
//   可用；DynamicModel 行字段用属性访问（rows[0].c），没有 .get() 方法。

const RATE_LIMIT_PER_MIN = 60;
const WINDOW_MS = 60 * 1000;
const RETENTION_DAYS = 90;

const rateBuckets = globalThis.statsRateBuckets || (globalThis.statsRateBuckets = {});
// 时间戳同样挂 globalThis：goja require 缓存回收时 module 级变量会重置，而 buckets 还在
const lastCleanupRef = globalThis.statsLastCleanup || (globalThis.statsLastCleanup = { t: Date.now() });

function maybeCleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanupRef.t < 5 * 60 * 1000) return;
  lastCleanupRef.t = now;
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
    return e.request().header.get(name) || '';
  } catch (_) {
    return '';
  }
}

function getClientIP(e) {
  // 优先 echo 的 realIP()（遵循受信代理链；Caddy 会覆写 X-Forwarded-For 为真实远端），
  // 直连部署时回退到请求头。
  try {
    const real = e.realIP();
    if (real && String(real).trim()) return String(real).trim();
  } catch (_) {}
  const realIP = getHeader(e, 'X-Real-IP');
  if (realIP) return realIP.trim();
  const forwarded = getHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '';
}

function readBody(e) {
  try {
    const raw = readerToString(e.request().body, 4097);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
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

// admin 判定（detail=1 用）：token 对应的 users 记录 role 为 admin 或 super_admin
function isAdminRequest(e) {
  try {
    const info = $apis.requestInfo(e);
    const auth = info && (info.auth || info.authRecord);
    if (!auth) return false;
    const role = String(auth.get('role') || '').trim();
    return role === 'admin' || role === 'super_admin';
  } catch (_) {
    return false;
  }
}

// ---- POST /api/track-view ----
function trackView(e) {
  const ip = getClientIP(e) || 'unknown';
  if (isRateLimited('tv:' + ip, RATE_LIMIT_PER_MIN)) {
    return e.json(429, { ok: false, error: 'RATE_LIMITED' });
  }

  const body = readBody(e);
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!isValidPath(path)) {
    return e.json(400, { ok: false, error: 'INVALID_PATH' });
  }

  // 内部路径不入库（/admin 后台、/api、/_ 系统路径）：静默 202，不记录
  if (path.startsWith('/admin') || path.startsWith('/api') || path.startsWith('/_')) {
    return e.json(202, { ok: true });
  }

  let referrer = typeof body.referrer === 'string' ? body.referrer.trim() : '';
  if (referrer.length > 500) referrer = referrer.slice(0, 500);
  // 只保留来源源（scheme://host），去掉可能携带 token 的 query/path
  const originMatch = referrer.match(/^https?:\/\/[^/]+/i);
  if (originMatch) referrer = originMatch[0];

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
}

// ---- GET /api/blog-stats ----
function blogStats(e) {
  const range = e.queryParam('range') === '7d' ? '7d' : '30d';
  const from = rangeStart(range);
  // created 为 UTC 存储：把“本地零点”渲染成 UTC 字符串再比较（生产容器 TZ=Asia/Shanghai）
  const todayFrom = new Date(new Date().setHours(0, 0, 0, 0)).toISOString().replace('T', ' ').slice(0, 19);

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
      'SELECT DATE(created, \'localtime\') AS d, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY DATE(created, \'localtime\') ORDER BY d ASC',
      { ev: 'pageview', from }, { d: '', c: 0 });
    const topPagesRaw = queryRows(
      'SELECT path, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY path ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from }, { path: '', c: 0 });
    const topRefRaw = queryRows(
      'SELECT referrer, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND referrer != \'\' AND created >= {:from} GROUP BY referrer ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from }, { referrer: '', c: 0 });

    const response = {
      range,
      totalViews: Number((totalRows[0] && totalRows[0].c) || 0),
      todayViews: Number((todayRows[0] && todayRows[0].c) || 0),
      uniqueVisitors: Number((uvRows[0] && uvRows[0].c) || 0),
      daily: dailyRaw.map((r) => ({ date: String(r.d), views: Number(r.c) })),
      topPages: topPagesRaw.map((r) => ({ path: String(r.path), views: Number(r.c) })),
      topReferrers: topRefRaw.map((r) => ({ referrer: String(r.referrer), views: Number(r.c) })),
    };

    // admin 会话 + detail=1：附加 UA 分类分布
    const wantDetail = e.queryParam('detail') === '1';
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
}

// ---- 每日清理 90 天前数据（由 cronAdd 注册，'17 3 * * *'） ----
function retentionCleanup() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  try {
    $app.dao().db().newQuery('DELETE FROM page_views WHERE created < {:cutoff}')
      .bind({ cutoff }).execute();
  } catch (error) {
    console.error('[stats] retention cleanup failed: ' + error);
  }
}

module.exports = {
  trackView: trackView,
  blogStats: blogStats,
  retentionCleanup: retentionCleanup,
};
