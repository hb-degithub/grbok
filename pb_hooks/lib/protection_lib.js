'use strict';

// 防护拦截统计:宿主机采集器把雷池(WAF)24h 窗口的 检测/拦截 计数写进来,
// 公开端只输出脱敏汇总与状态,后台端输出采集健康明细。
// 挑战数与挑战语义在雷池社区版无可靠事件流,一律按"未接入"处理(不编造 0)。

var monitorLib = require('./monitor_lib.js');

var STALE_AFTER_MS = 5 * 60 * 1000; // 采样间隔 1 分钟,超 5 分钟未成功即过期
var PUBLIC_CACHE_MS = 10 * 1000;

function clampCount(v) {
  var n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(100000000, Math.round(n));
}

// POST /api/internal/monitor/protection — 采集器写入(内网+密钥双校验)
function saveSnapshot(e) {
  var secret = String($os.getenv('ADMIN_AUTH_INTERNAL_SECRET') || '').trim();
  var provided = '';
  try { provided = String(e.request().header.get('X-Internal-Secret') || '').trim(); } catch (_) {}
  if (!secret || !provided || !$security.equal(secret, provided)) {
    return e.json(403, { code: 'FORBIDDEN' });
  }
  if (!monitorLib.isInternalRequest(e)) {
    return e.json(403, { code: 'FORBIDDEN' });
  }
  var body;
  try { body = JSON.parse(readerToString(e.request().body, 4097) || '{}'); } catch (_) {
    return e.json(400, { code: 'INVALID_REQUEST' });
  }
  var ok = body.ok !== false;
  var record = new Record($app.dao().findCollectionByNameOrId('protection_snapshots'));
  record.set('source', 'safeline');
  record.set('ok', ok);
  record.set('detected', ok ? clampCount(body.detected) : 0);
  record.set('blocked', ok ? clampCount(body.blocked) : 0);
  record.set('challenged', 0); // 挑战统计未接入,恒 0 占位,公开端不展示
  record.set('window_hours', 24);
  record.set('sampled_at', String(body.sampledAt || new Date().toISOString()).slice(0, 40));
  record.set('error', ok ? '' : String(body.error || 'unknown').slice(0, 200));
  try {
    $app.dao().saveRecord(record);
  } catch (err) {
    console.error('[protection] operation=ingest result=SAVE_FAILED detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
  return e.json(202, { accepted: true });
}

function latestSnapshot(dao, okOnly) {
  var filter = okOnly ? "source = 'safeline' && ok = true" : "source = 'safeline'";
  var rows = dao.findRecordsByFilter('protection_snapshots', filter, '-created', 1, 0);
  return rows && rows.length ? rows[0] : null;
}

// GET /api/public/protection — 脱敏公开汇总
function getPublicProtection(e) {
  try {
    var cache = globalThis.__protectionPublicCache || (globalThis.__protectionPublicCache = { t: 0, payload: null });
    var now = Date.now();
    if (cache.payload && now - cache.t < PUBLIC_CACHE_MS) return e.json(200, cache.payload);

    var latestOk = null;
    try { latestOk = latestSnapshot($app.dao(), true); } catch (_) {}

    var safeline = { state: 'unavailable', updatedAt: null, windowHours: 24, detected: null, blocked: null };
    if (latestOk) {
      var sampledAt = Date.parse(String(latestOk.getString('sampled_at') || ''));
      var stale = !isFinite(sampledAt) || (now - sampledAt > STALE_AFTER_MS);
      safeline = {
        state: stale ? 'stale' : 'ok',
        updatedAt: latestOk.getString('sampled_at'),
        windowHours: latestOk.getInt('window_hours') || 24,
        detected: latestOk.getInt('detected'),
        blocked: latestOk.getInt('blocked'),
      };
    }

    var payload = {
      now: new Date().toISOString(),
      safeline: safeline,
      esa: { state: 'unconfigured' },
      challenge: { state: 'unavailable' }, // 挑战语义社区版无可靠事件流,明确未接入
    };
    cache.t = now;
    cache.payload = payload;
    return e.json(200, payload);
  } catch (err) {
    console.error('[protection] operation=public-status result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

// GET /api/blog-admin/monitor/protection — 后台采集健康明细
function getAdminProtection(e) {
  if (!monitorLib.requireMonitorAdmin(e)) return e.json(403, { code: 'FORBIDDEN' });
  try {
    var rows = $app.dao().findRecordsByFilter('protection_snapshots', "source = 'safeline'", '-created', 10, 0);
    var latest10 = [];
    var lastSuccessAt = null;
    var consecutiveFailures = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ok = r.getBool('ok');
      latest10.push({
        ok: ok,
        detected: r.getInt('detected'),
        blocked: r.getInt('blocked'),
        sampledAt: r.getString('sampled_at'),
        error: r.getString('error'),
        at: r.getString('created'),
      });
      if (ok && !lastSuccessAt) lastSuccessAt = r.getString('created');
      if (!ok && lastSuccessAt === null) consecutiveFailures++;
    }
    return e.json(200, { latest10: latest10, lastSuccessAt: lastSuccessAt, consecutiveFailures: consecutiveFailures });
  } catch (err) {
    console.error('[protection] operation=admin-detail result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

module.exports = {
  saveSnapshot: saveSnapshot,
  getPublicProtection: getPublicProtection,
  getAdminProtection: getAdminProtection,
};
