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

function isValidPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return false;
  if (path[0] !== '/' || path.startsWith('//')) return false;
  if (path.includes('..') || path.includes('\\')) return false;
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

function trackView(e) {
  const ip = getClientIP(e);
  if (!ip) return trackingUnavailable(e);

  let rateSubject;
  try {
    rateSubject = mailCrypto.hashPrivate('stats-rate-ip', ip);
  } catch (_) {
    return trackingUnavailable(e);
  }
  if (isRateLimited('tv:' + rateSubject, RATE_LIMIT_PER_MIN)) {
    return e.json(429, { ok: false, error: 'RATE_LIMITED' });
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

  try {
    const collection = $app.dao().findCollectionByNameOrId('page_views');
    const record = new Record(collection);
    record.set('path', path);
    record.set('referrer', referrer);
    record.set('ua_category', category);
    record.set('visitor_hash', visitorHashValue);
    record.set('event', event);
    if (event === 'link_click') record.set('target', target);
    // 访客地理（仅 pageview 解析，link_click 复用意义不大且省一次内网调用）
    if (event === 'pageview') {
      try {
        const geo = require('./stats_geo.js').resolve(e, ip);
        if (geo && geo.country) {
          record.set('country', geo.country);
          record.set('region_code', geo.region_code || '');
          record.set('city', geo.city || '');
        }
      } catch (_) {}
    }
    $app.dao().saveRecord(record);
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
  const from = rangeStart(range);
  const todayFrom = new Date(new Date().setHours(0, 0, 0, 0))
    .toISOString().replace('T', ' ').slice(0, 19);

  try {
    // 合并基础统计查询：totalViews, todayViews, uniqueVisitors
    const baseStatsRows = queryRows(
      `SELECT 
        COUNT(*) AS total_views,
        SUM(CASE WHEN created >= {:todayFrom} THEN 1 ELSE 0 END) AS today_views,
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

    if (e.queryParam('detail') === '1' && isAdminRequest(e)) {
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

    // 访客地理聚合（仅 admin，用于后台地图；不返回 visitor_hash 与单条记录）
    if (e.queryParam('geo') === '1' && isAdminRequest(e)) {
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
};
