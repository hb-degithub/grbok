'use strict';

const mailCrypto = require('./mail_crypto.js');

const RATE_LIMIT_PER_MIN = 60;
const STATS_RATE_LIMIT_PER_MIN = 30; // blogStats 查询接口限制更严格
const WINDOW_MS = 60 * 1000;
const RETENTION_DAYS = 90;

const rateBuckets = globalThis.statsRateBuckets || (globalThis.statsRateBuckets = {});
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
  try {
    return require('./client_ip.js').clientIp(e);
  } catch (_) {
    return '';
  }
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
  const value = (ua || '').toLowerCase();
  if (/bot|spider|crawl|slurp|curl|wget|python|headless|scrapy/.test(value)) return 'bot';
  if (/ipad|tablet/.test(value)) return 'tablet';
  if (/mobi|android|iphone|ipod/.test(value)) return 'mobile';
  return 'desktop';
}

// 路径长度上限（与旧实现一致，显式命名）。
const MAX_PATH_LENGTH = 200;

// 允许的路径字符集白名单（2026-10-14 渗透测试 #9 修复；旧实现在 :71-76 只做
// 长度/前缀/`..`/反斜杠校验，<b>hi</b>、\x00、任意文本都能写进公开 topPages）。
//   * RFC 3986 unreserved（A-Za-z0-9 - . _ ~）与 sub-delims/:/@（!$&'()*+,;=:@）
//   * 路径分隔符 /、百分号编码引导符 %（另由 PATH_BAD_ESCAPE_PATTERN 要求后接两位十六进制）
//   * 查询/片段分隔符 ? #（location.pathname 不含它们，extractPostSlug 也会剥离，放行无害）
//   * CJK 汉字 / 日文假名 / 韩文音节的"原字符"：浏览器 location.pathname 通常已把非 ASCII
//     百分号编码为 %XX，但直接放行这些码位不会引入 HTML 注入面（< > " ' 反引号 与全部
//     控制字符都不在集合内），却能避免误伤 /tags/中文 这类路由。
// 明确拒绝：空白（含 \t \n \u3000）、\x00-\x1f、\x7f、< > " ` \ { } | ^ 等。
const PATH_ALLOWED_PATTERN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@\/%?#\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+$/;
// 每个 % 必须是合法百分号编码引导：浏览器只会产出 %XX，裸 % 或 %zz 一律拒绝。
const PATH_BAD_ESCAPE_PATTERN = /%(?![0-9A-Fa-f]{2})/;

function isValidPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path[0] !== '/' || path.startsWith('//')) return false;
  if (path.includes('..') || path.includes('\\')) return false;
  if (!PATH_ALLOWED_PATTERN.test(path)) return false;
  if (PATH_BAD_ESCAPE_PATTERN.test(path)) return false;
  return true;
}

function validTargetShape(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 500
    && /^https?:\/\/[^\s\u0000-\u001f]+$/i.test(value);
}

function isVisibleFriendTarget(dao, target) {
  try {
    return !!dao.findFirstRecordByFilter(
      'friend_links',
      'status = "show" && url = {:target}',
      { target: target },
    );
  } catch (_) {
    return false;
  }
}

function safeReferrerOrigin(value) {
  if (typeof value !== 'string') return '';
  var source = value.trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return '';
  var match = /^(https?):\/\/([^\/?#\\\s]+)(?:[\/?#]|$)/i.exec(source);
  if (!match || !match[2] || match[2].indexOf('@') !== -1) return '';
  var origin = match[1].toLowerCase() + '://' + match[2];
  return origin.length <= 500 ? origin : '';
}

function visitorHash(ip, userAgent, day) {
  return mailCrypto.hashPrivate('stats-visitor-day', ip + '|' + userAgent + '|' + day);
}

function todayString() {
  const now = new Date();
  return now.getFullYear()
    + '-' + String(now.getMonth() + 1).padStart(2, '0')
    + '-' + String(now.getDate()).padStart(2, '0');
}

function rangeStart(range) {
  const days = range === '7d' ? 7 : 30;
  const value = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return value.toISOString().replace('T', ' ').slice(0, 19);
}

function queryRows(sql, params, shape) {
  const rows = arrayOf(new DynamicModel(shape));
  $app.dao().db().newQuery(sql).bind(params).all(rows);
  return rows;
}

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

function trackingUnavailable(e) {
  return e.json(503, { ok: false, error: 'TRACKING_UNAVAILABLE' });
}

// 从上报 path 中提取文章 slug。path 已过 isValidPath 校验（以 / 开头、无 .. 与反斜杠）。
// 容忍查询参数/哈希与尾部斜杠；非 /posts/<slug> 或 slug 中含多级路径时返回 ''。
// 仅用字符串操作（JSVM 禁用部分原生数组方法，见项目已知陷阱）。
function extractPostSlug(path) {
  var p = String(path || '');
  var q = p.indexOf('?');
  if (q !== -1) p = p.slice(0, q);
  var h = p.indexOf('#');
  if (h !== -1) p = p.slice(0, h);
  while (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, p.length - 1);
  var prefix = '/posts/';
  if (p.indexOf(prefix) !== 0) return '';
  var slug = p.slice(prefix.length);
  if (!slug || slug.indexOf('/') !== -1) return '';
  return slug;
}

// 2026-11-16 渗透测试 #24：只有「存在且已发布」的文章才允许计数。
// 旧实现按 slug 查 posts（不看 status），匿名请求可以把草稿/归档甚至已删除
// 文章的历史 slug 刷出浏览量。slug 可能是 URL 编码形式（浏览器 location.pathname
// 对非 ASCII 会编码），先试原样再试解码；两者都查不到或不是 published 一律返回 null。
function findPublishedPostBySlug(slug) {
  if (!slug) return null;
  var dao = $app.dao();
  var candidates = [slug];
  var decoded = null;
  try {
    decoded = decodeURIComponent(slug);
  } catch (_) {
    decoded = null;
  }
  if (decoded && decoded !== slug) candidates.push(decoded);
  for (var i = 0; i < candidates.length; i++) {
    try {
      var post = dao.findFirstRecordByFilter(
        'posts',
        'slug = {:slug} && status = "published"',
        { slug: candidates[i] },
      );
      if (post) return post;
    } catch (_) {}
  }
  return null;
}

// 同一 visitor 的每日去重：visitor_hash 本身按日轮换（见 visitorHash），
// 因此「同一 visitor_hash + 同一 path 已有 pageview」等价于当天已计过一次。
// 查询失败时按"已计数"处理：宁可少计一次，也不重复放大浏览量。
function hasExistingPageView(dao, visitorHashValue, path) {
  try {
    var rows = dao.findRecordsByFilter(
      'page_views',
      'visitor_hash = {:hash} && path = {:path} && event = "pageview"',
      '',
      1,
      0,
      { hash: visitorHashValue, path: path },
    );
    return rows.length > 0;
  } catch (_) {
    return true;
  }
}

// 持久化限流（security_rate_policies 的 view_ip 策略键）。
// 模块缺失只可能出现在只复制部分 lib 的精简夹具环境；此时回退到旧内存桶，
// 保持既有测试契约。模块存在但策略降级/写失败时 fail-closed（503）。
function checkPersistentViewRate(ip) {
  var securityRate;
  try {
    securityRate = require('./security_rate_limit.js');
  } catch (_) {
    return { available: false };
  }
  var subject = ip;
  try {
    subject = securityRate.normalizeIp(ip);
  } catch (_) {
    subject = ip;
  }
  var decision = null;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = securityRate.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: 'view_ip', subject: subject }],
      });
    });
  } catch (_) {
    return { available: true, failed: true };
  }
  if (!decision || typeof decision.allowed !== 'boolean') return { available: true, failed: true };
  return {
    available: true,
    allowed: decision.allowed,
    retryAfterSeconds: decision.retryAfterSeconds || 1,
  };
}

function trackView(e) {
  const ip = getClientIP(e);
  if (!ip) return trackingUnavailable(e);

  // 2026-11-16 渗透测试 #24：匿名上报纳入持久化限流（view_ip 策略键）。
  const persistentRate = checkPersistentViewRate(ip);
  if (persistentRate.available) {
    if (persistentRate.failed) return trackingUnavailable(e);
    if (!persistentRate.allowed) {
      return e.json(429, { ok: false, error: 'RATE_LIMITED' });
    }
  } else {
    // 精简夹具环境没有 security_rate_limit.js：保留旧内存桶兜底。
    let rateSubject;
    try {
      rateSubject = mailCrypto.hashPrivate('stats-rate-ip', ip);
    } catch (_) {
      return trackingUnavailable(e);
    }
    if (isRateLimited('tv:' + rateSubject, RATE_LIMIT_PER_MIN)) {
      return e.json(429, { ok: false, error: 'RATE_LIMITED' });
    }
  }

  const body = readBody(e);
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!isValidPath(path)) {
    return e.json(400, { ok: false, error: 'INVALID_PATH' });
  }

  if (path.startsWith('/admin') || path.startsWith('/api') || path.startsWith('/_')) {
    return e.json(202, { ok: true });
  }

  const event = body.event === 'link_click' ? 'link_click' : 'pageview';
  let target = '';
  if (event === 'link_click') {
    target = body.target;
    if (!validTargetShape(target) || !isVisibleFriendTarget($app.dao(), target)) {
      return e.json(400, { ok: false, error: 'INVALID_TARGET' });
    }
  }

  const referrer = safeReferrerOrigin(body.referrer);
  const userAgent = getHeader(e, 'User-Agent');
  const category = classifyUA(userAgent);
  let visitorHashValue;
  try {
    visitorHashValue = visitorHash(ip, userAgent, todayString());
  } catch (_) {
    return trackingUnavailable(e);
  }

  // 文章路径必须解析到「存在且已发布」的文章；否则按前端兼容的成功响应返回，
  // 不写 page_views、不递增 posts.views（draft/archived/不存在的 slug 均不可计数）。
  // 非 /posts/<slug> 路径仍作为普通页面浏览记录（/api/blog-stats 与既有统计夹具依赖）。
  let post = null;
  if (event === 'pageview') {
    const slug = extractPostSlug(path);
    if (slug) {
      post = findPublishedPostBySlug(slug);
      if (!post) return e.json(202, { ok: true });
    }
  }

  // 访客地理（仅 pageview 解析，link_click 复用意义不大且省一次内网调用）。
  // 在事务外解析，避免内网调用占用写事务。
  let geo = null;
  if (event === 'pageview') {
    try {
      geo = require('./stats_geo.js').resolve(e, ip);
    } catch (_) {
      geo = null;
    }
  }

  try {
    $app.dao().runInTransaction(function (txDao) {
      // 同一 visitor 当天对同一 path 只计一次浏览量；page_views 全量行仍保留，
      // 供 /api/blog-stats 的 totalViews/topPages 使用（限流已约束写入速率）。
      var alreadyCounted = false;
      if (post) alreadyCounted = hasExistingPageView(txDao, visitorHashValue, path);

      const collection = txDao.findCollectionByNameOrId('page_views');
      const record = new Record(collection);
      record.set('path', path);
      record.set('referrer', referrer);
      record.set('ua_category', category);
      record.set('visitor_hash', visitorHashValue);
      record.set('event', event);
      if (event === 'link_click') record.set('target', target);
      if (geo && geo.country) {
        record.set('country', geo.country);
        record.set('region_code', geo.region_code || '');
        record.set('city', geo.city || '');
      }
      txDao.saveRecord(record);

      if (post && !alreadyCounted) {
        var stored = txDao.findRecordById('posts', post.id);
        var current = Number(stored.get('views'));
        if (!isFinite(current) || current < 0) current = 0;
        stored.set('views', current + 1);
        txDao.saveRecord(stored);
      }
    });
  } catch (_) {
    console.error('[stats][STATS_TRACK_SAVE_FAILED]');
    return trackingUnavailable(e);
  }

  return e.json(202, { ok: true });
}

function blogStats(e) {
  // 速率限制：防止恶意刷查询接口
  const ip = getClientIP(e);
  if (ip) {
    let rateSubject;
    try {
      rateSubject = mailCrypto.hashPrivate('stats-query-ip', ip);
    } catch (_) {
      rateSubject = ip; // 降级使用原始 IP（仅内存中，不落库）
    }
    if (isRateLimited('bs:' + rateSubject, STATS_RATE_LIMIT_PER_MIN)) {
      return e.json(429, { ok: false, error: 'RATE_LIMITED' });
    }
  }

  const range = e.queryParam('range') === '7d' ? '7d' : '30d';
  const wantGeo = e.queryParam('geo') === '1';
  const adminRequest = isAdminRequest(e);
  const wantDetail = e.queryParam('detail') === '1' && adminRequest;

  // 聚合结果 60s 进程缓存：page_views 的 COUNT DISTINCT 全表扫描随数据量增长，
  // /stats 页与首页 StatusMini 重复查询直接命中内存。detail 结果含管理视角数据，
  // 与公开结果分键存放，缓存 key 携带 admin 标记防串。
  const cacheKey = range + '|' + (wantGeo ? 'g1' : 'g0') + '|' + (wantDetail ? 'd1' : 'd0') + (adminRequest ? '|a1' : '|a0');
  const queryCache = globalThis.statsQueryResultCache || (globalThis.statsQueryResultCache = {});
  const cached = queryCache[cacheKey];
  if (cached && cached.expiry > Date.now()) {
    return e.json(200, cached.data);
  }

  const from = rangeStart(range);
  const todayFrom = new Date(new Date().setHours(0, 0, 0, 0))
    .toISOString().replace('T', ' ').slice(0, 19);

  try {
    // 合并基础统计查询：totalViews, todayViews, uniqueVisitors
    const baseStatsRows = queryRows(
      `SELECT 
        COUNT(*) AS total_views,
        COALESCE(SUM(CASE WHEN created >= {:todayFrom} THEN 1 ELSE 0 END), 0) AS today_views,
        COUNT(DISTINCT visitor_hash) AS unique_visitors
      FROM page_views 
      WHERE event = {:ev} AND created >= {:from}`,
      { ev: 'pageview', from: from, todayFrom: todayFrom }, 
      { total_views: 0, today_views: 0, unique_visitors: 0 });

    const baseStats = baseStatsRows[0] || { total_views: 0, today_views: 0, unique_visitors: 0 };

    const dailyRaw = queryRows(
      'SELECT DATE(created, \'localtime\') AS d, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY DATE(created, \'localtime\') ORDER BY d ASC',
      { ev: 'pageview', from: from }, { d: '', c: 0 });
    const topPagesRaw = queryRows(
      'SELECT path, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY path ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from: from }, { path: '', c: 0 });
    const topRefRaw = queryRows(
      'SELECT referrer, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND referrer != \'\' AND created >= {:from} GROUP BY referrer ORDER BY c DESC LIMIT 10',
      { ev: 'pageview', from: from }, { referrer: '', c: 0 });

    const response = {
      range: range,
      totalViews: Number(baseStats.total_views || 0),
      todayViews: Number(baseStats.today_views || 0),
      uniqueVisitors: Number(baseStats.unique_visitors || 0),
      daily: dailyRaw.map((row) => ({ date: String(row.d), views: Number(row.c) })),
      topPages: topPagesRaw.map((row) => ({ path: String(row.path), views: Number(row.c) })),
      topReferrers: topRefRaw.map((row) => ({
        referrer: String(row.referrer),
        views: Number(row.c),
      })),
    };

    if (wantDetail) {
      const uaRaw = queryRows(
        'SELECT ua_category, COUNT(*) AS c FROM page_views WHERE event = {:ev} AND created >= {:from} GROUP BY ua_category ORDER BY c DESC',
        { ev: 'pageview', from: from }, { ua_category: '', c: 0 });
      response.detail = {
        uaCategories: uaRaw.map((row) => ({
          category: String(row.ua_category),
          views: Number(row.c),
        })),
      };
    }

    // 访客地理聚合（geo=1 时对所有用户开放；仅返回聚合数字与国家/省份名称，不返回 visitor_hash 与单条记录）
    if (wantGeo) {
      const countryRaw = queryRows(
        "SELECT country, COUNT(*) AS c, COUNT(DISTINCT visitor_hash) AS uv FROM page_views WHERE event = {:ev} AND created >= {:from} AND country != '' GROUP BY country ORDER BY c DESC",
        { ev: 'pageview', from: from }, { country: '', c: 0, uv: 0 });
      const regionRaw = queryRows(
        "SELECT country, region_code, city, COUNT(*) AS c, COUNT(DISTINCT visitor_hash) AS uv FROM page_views WHERE event = {:ev} AND created >= {:from} AND country != '' GROUP BY country, region_code ORDER BY c DESC",
        { ev: 'pageview', from: from }, { country: '', region_code: '', city: '', c: 0, uv: 0 });
      response.geo = {
        countries: countryRaw.map((row) => ({
          country: String(row.country),
          views: Number(row.c),
          uniqueVisitors: Number(row.uv),
        })),
        regions: regionRaw.map((row) => ({
          country: String(row.country),
          region: String(row.region_code),
          city: String(row.city || ''),
          views: Number(row.c),
          uniqueVisitors: Number(row.uv),
        })),
      };
    }

    queryCache[cacheKey] = { expiry: Date.now() + 60 * 1000, data: response };
    return e.json(200, response);
  } catch (_) {
    console.error('[stats][STATS_QUERY_FAILED]');
    return e.json(500, { ok: false, error: 'QUERY_FAILED' });
  }
}

function friendLinkStats(e) {
  const from = rangeStart('30d');
  try {
    const rows = queryRows(
      'SELECT pv.target, COUNT(*) AS clicks '
        + 'FROM page_views pv '
        + "INNER JOIN friend_links fl ON fl.url = pv.target AND fl.status = 'show' "
        + "WHERE pv.event = 'link_click' "
        + "AND pv.target != '' "
        + 'AND pv.created >= {:from} '
        + 'GROUP BY pv.target '
        + 'ORDER BY clicks DESC, pv.target ASC '
        + 'LIMIT 10',
      { from: from },
      { target: '', clicks: 0 },
    );
    return e.json(200, {
      range: '30d',
      top: rows.map((row) => ({
        target: String(row.target),
        clicks: Number(row.clicks),
      })),
    });
  } catch (_) {
    console.error('[stats][FRIEND_STATS_QUERY_FAILED]');
    return trackingUnavailable(e);
  }
}

function retentionCleanup() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  try {
    $app.dao().db().newQuery('DELETE FROM page_views WHERE created < {:cutoff}')
      .bind({ cutoff: cutoff }).execute();
  } catch (_) {
    console.error('[stats][STATS_RETENTION_FAILED]');
  }
}

module.exports = {
  trackView: trackView,
  blogStats: blogStats,
  friendLinkStats: friendLinkStats,
  retentionCleanup: retentionCleanup,
  // 供测试夹具直接穷举字符集白名单（tests/security-rate/login_otp_rate_fixture.pb.js）
  isValidPath: isValidPath,
  MAX_PATH_LENGTH: MAX_PATH_LENGTH,
};
