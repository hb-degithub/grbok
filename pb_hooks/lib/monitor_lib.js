'use strict';

// 运行状态监控:每分钟探针(site_http / pb_self / admin_auth)+ 保留期清理 +
// 公开状态聚合(脱敏)与后台明细查询。样本落 monitor_samples 集合(规则全 null,
// 仅 hooks 可读写)。宿主机性能指标由宿主机 cron 脚本 POST 进来(monitor_host_samples)。

var RETENTION_MS = 7 * 24 * 3600 * 1000; // 样本保留 7 天
var PUBLIC_CACHE_MS = 10 * 1000;         // 公开聚合结果内存缓存 10s(防刷)
var PUBLIC_RECENT_LIMIT = 60;            // 公开接口每目标返回最近 60 个采样点

// 公开标识 -> 内部 target 映射(内部名称/地址不外泄)
var PUBLIC_TARGETS = [
  { key: 'site', target: 'site_http', label: '站点页面' },
  { key: 'api', target: 'pb_self', label: 'API 与数据库' },
  { key: 'gateway', target: 'admin_auth', label: '认证与邮件网关' },
];

function clientIpOf(c) {
  try { return require('./client_ip.js').clientIp(c) || ''; } catch (_) { return ''; }
}

// 内部调用方判定:回环 + Docker 内网网关。宿主机访问 Caddy 发布端口时,
// 经 docker 代理后源地址是网关 IP(实测 10.255.2.1)而非 127.0.0.1。
// 外部请求因 ESA 覆写 ali-real-client-ip 不可能取得该地址,密钥仍是主闸门。
function isInternalCaller(ip) {
  var v = String(ip || '').trim().toLowerCase();
  if (v === '::1' || v === '0:0:0:0:0:0:0:1') return true;
  if (v.indexOf('::ffff:') === 0) v = v.slice(7);
  var first = v.split('.')[0];
  if (first === '127') return true;
  return v.indexOf('10.255.') === 0;
}

function clampNum(v, min, max) {
  var n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function pbNow() {
  return new Date().toISOString().replace('T', ' ');
}

function siteProbeUrl() {
  var v = String($os.getenv('MONITOR_SITE_URL') || '').trim();
  return v || 'http://caddy/';
}

function adminAuthHealthUrl() {
  var base = String($os.getenv('ADMIN_AUTH_INTERNAL_URL') || '').trim() || 'http://admin-auth:8787';
  return base.replace(/\/$/, '') + '/health';
}

function saveSample(txDao, target, ok, latencyMs, statusCode, error) {
  var collection = txDao.findCollectionByNameOrId('monitor_samples');
  var record = new Record(collection);
  record.set('target', target);
  record.set('ok', !!ok);
  record.set('latency_ms', Math.max(0, Math.round(latencyMs || 0)));
  record.set('status_code', statusCode || 0);
  record.set('error', String(error || '').slice(0, 200));
  txDao.saveRecord(record);
}

function probeHttp(url) {
  var started = Date.now();
  try {
    var res = $http.send({ url: url, method: 'GET', timeout: 5 });
    var code = Number(res.statusCode || 0);
    return { ok: code > 0 && code < 500, latencyMs: Date.now() - started, statusCode: code, error: code >= 500 ? 'http_' + code : '' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, statusCode: 0, error: String(err && err.message || err).slice(0, 120) };
  }
}

function probePbSelf() {
  var started = Date.now();
  try {
    // 一次真实的数据库读作为存活性采样
    $app.dao().findFirstRecordByFilter('settings', 'id != ""');
    return { ok: true, latencyMs: Date.now() - started, statusCode: 200, error: '' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, statusCode: 0, error: String(err && err.message || err).slice(0, 120) };
  }
}

function runProbes() {
  var results = [
    { target: 'pb_self', r: probePbSelf() },
    { target: 'site_http', r: probeHttp(siteProbeUrl()) },
    { target: 'admin_auth', r: probeHttp(adminAuthHealthUrl()) },
  ];
  try {
    $app.dao().runInTransaction(function (txDao) {
      for (var i = 0; i < results.length; i++) {
        saveSample(txDao, results[i].target, results[i].r.ok, results[i].r.latencyMs, results[i].r.statusCode, results[i].r.error);
      }
    });
  } catch (err) {
    console.error('[monitor] operation=probe result=SAVE_FAILED detail=' + String(err && err.message || err).slice(0, 120));
  }
}

function cleanupExpired() {
  var cutoff = new Date(Date.now() - RETENTION_MS).toISOString().replace('T', ' ');
  var total = 0;
  var collections = ['monitor_samples', 'monitor_host_samples'];
  for (var c = 0; c < collections.length; c++) {
    while (true) {
      var deleted = 0;
      (function (name) {
        $app.dao().runInTransaction(function (txDao) {
          var rows = txDao.findRecordsByFilter(name, 'created < {:cutoff}', 'created', 500, 0, { cutoff: cutoff });
          for (var i = 0; i < rows.length; i++) txDao.deleteRecord(rows[i]);
          deleted = rows.length;
        });
      })(collections[c]);
      total += deleted;
      if (deleted < 500) break;
    }
  }
  return total;
}

// 宿主机性能指标接收:仅回环地址 + 内部密钥(复用 ADMIN_AUTH_INTERNAL_SECRET,
// 与 mail_gateway 内网通道同一信任域)。数值全部截断到合理区间,异常字段丢弃。
function saveHostMetrics(e) {
  var secret = String($os.getenv('ADMIN_AUTH_INTERNAL_SECRET') || '').trim();
  var provided = '';
  try { provided = String(e.request().header.get('X-Internal-Secret') || '').trim(); } catch (_) {}
  if (!secret || !provided || !$security.equal(secret, provided)) {
    return e.json(403, { code: 'FORBIDDEN' });
  }
  if (!isInternalCaller(clientIpOf(e.httpContext || e))) {
    return e.json(403, { code: 'FORBIDDEN' });
  }
  var body;
  try { body = JSON.parse(readerToString(e.request().body, 4097) || '{}'); } catch (_) {
    return e.json(400, { code: 'INVALID_REQUEST' });
  }
  var record = new Record($app.dao().findCollectionByNameOrId('monitor_host_samples'));
  record.set('cpu_pct', clampNum(body.cpuPct, 0, 100));
  record.set('mem_pct', clampNum(body.memPct, 0, 100));
  record.set('mem_used_mb', clampNum(body.memUsedMb, 0, 1048576));
  record.set('mem_total_mb', clampNum(body.memTotalMb, 0, 1048576));
  record.set('net_rx_kbps', clampNum(body.rxKbps, 0, 10485760));
  record.set('net_tx_kbps', clampNum(body.txKbps, 0, 10485760));
  record.set('disk_pct', clampNum(body.diskPct, 0, 100));
  record.set('load1', clampNum(body.load1, 0, 1024));
  record.set('cpu_cores', clampNum(body.cpuCores, 0, 1024));
  try {
    $app.dao().saveRecord(record);
  } catch (err) {
    console.error('[monitor] operation=host-ingest result=SAVE_FAILED detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
  return e.json(202, { accepted: true });
}

function latestHostSample(dao) {
  var rows = dao.findRecordsByFilter('monitor_host_samples', 'id != ""', '-created', 1, 0);
  return rows && rows.length ? rows[0] : null;
}

// 公开的主机快照:仅百分比与速率,不含绝对容量与规格(脱敏)。
// 2026-09-20 审计:cpuCores/memTotalMb 曾对外暴露主机规格(与脱敏口径矛盾),已移除;
// 规格仅保留在后台接口 getAdminHostSeries(需 admin 角色)。
function publicHostSnapshot(dao) {
  var s = null;
  try { s = latestHostSample(dao); } catch (_) {}
  if (!s) return null;
  return {
    cpuPct: Math.round(s.get('cpu_pct') * 10) / 10,
    memPct: Math.round(s.get('mem_pct') * 10) / 10,
    diskPct: Math.round(s.get('disk_pct') * 10) / 10,
    rxKbps: Math.round(s.get('net_rx_kbps')),
    txKbps: Math.round(s.get('net_tx_kbps')),
    load1: Math.round(s.get('load1') * 100) / 100,
    at: s.getString('created'),
  };
}

function latestSample(dao, target) {
  var rows = dao.findRecordsByFilter('monitor_samples', 'target = {:target}', '-created', 1, 0, { target: target });
  return rows && rows.length ? rows[0] : null;
}

function recentSamples(dao, target, limit) {
  var rows = dao.findRecordsByFilter('monitor_samples', 'target = {:target}', '-created', limit, 0, { target: target });
  var out = [];
  // 反转为时间升序,前端直接画
  for (var i = rows.length - 1; i >= 0; i--) {
    out.push({ t: rows[i].getString('created'), ok: rows[i].getBool('ok'), ms: rows[i].getInt('latency_ms') });
  }
  return out;
}

function aggregate(dao, target, sinceMs) {
  var cutoff = new Date(Date.now() - sinceMs).toISOString().replace('T', ' ');
  var rows = dao.findRecordsByFilter('monitor_samples', 'target = {:target} && created >= {:cutoff}', 'created', 10080, 0, { target: target, cutoff: cutoff });
  var total = rows.length;
  var okCount = 0;
  var latencies = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getBool('ok')) okCount++;
    latencies.push(rows[i].getInt('latency_ms'));
  }
  latencies.sort(function (a, b) { return a - b; });
  function pct(p) {
    if (!latencies.length) return 0;
    var idx = Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1);
    return latencies[Math.max(0, idx)];
  }
  return {
    total: total,
    okCount: okCount,
    uptime: total ? Math.round((okCount / total) * 1000) / 10 : null,
    avgMs: total ? Math.round(latencies.reduce(function (a, b) { return a + b; }, 0) / total) : null,
    p50Ms: latencies.length ? pct(50) : null,
    p95Ms: latencies.length ? pct(95) : null,
  };
}

// 公开状态:只输出 ok / 延迟 / 可用率 / 采样点,不含内网地址与错误详情。
// 结果在 globalThis 缓存 10s,避免公开接口被刷时对库造成压力。
function getPublicStatus(e) {
  try {
    var cache = globalThis.__monitorPublicCache || (globalThis.__monitorPublicCache = { t: 0, payload: null });
    var now = Date.now();
    if (cache.payload && now - cache.t < PUBLIC_CACHE_MS) return e.json(200, cache.payload);

    var services = [];
    for (var i = 0; i < PUBLIC_TARGETS.length; i++) {
      var meta = PUBLIC_TARGETS[i];
      var latest = null;
      try { latest = latestSample($app.dao(), meta.target); } catch (_) {}
      var agg24 = null;
      try { agg24 = aggregate($app.dao(), meta.target, 24 * 3600 * 1000); } catch (_) {}
      var recent = [];
      try { recent = recentSamples($app.dao(), meta.target, PUBLIC_RECENT_LIMIT); } catch (_) {}
      services.push({
        key: meta.key,
        label: meta.label,
        ok: latest ? latest.getBool('ok') : null,
        latencyMs: latest ? latest.getInt('latency_ms') : null,
        lastCheck: latest ? latest.getString('created') : null,
        uptime24h: agg24 ? agg24.uptime : null,
        avgLatency24h: agg24 ? agg24.avgMs : null,
        recent: recent,
      });
    }
    var allOk = services.every(function (s) { return s.ok === true; });
    var anyDown = services.some(function (s) { return s.ok === false; });
    var payload = {
      now: new Date().toISOString(),
      overall: allOk ? 'operational' : (anyDown ? 'outage' : 'unknown'),
      services: services,
      host: publicHostSnapshot($app.dao()),
    };
    cache.t = now;
    cache.payload = payload;
    return e.json(200, payload);
  } catch (err) {
    console.error('[monitor] operation=public-status result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

// PB 0.22 的 routerAdd 自定义路由不会填充 e.auth（恒为 null），
// 鉴权记录要从请求上下文回退链读取（2026-09-19 生产实测：裸读 e.auth
// 导致监控后台接口全员 403，protection_lib 经本函数同受影响）。
function resolveAuth(e) {
  try {
    if (e.auth && e.auth.id) return e.auth;
  } catch (_) {}
  try {
    var info = $apis.requestInfo(e);
    if (info && info.auth && info.auth.id) return info.auth;
    if (info && info.authRecord && info.authRecord.id) return info.authRecord;
  } catch (_) {}
  try {
    var record = e.get('authRecord') || e.get('auth');
    if (record && record.id) return record;
  } catch (_) {}
  return null;
}

function requireMonitorAdmin(e) {
  var auth = resolveAuth(e);
  if (!auth || !auth.id) return null;
  var role = auth.getString('role');
  if (role !== 'admin' && role !== 'super_admin') return null;
  return auth;
}

// 后台汇总:各目标 24h/7d 可用率与延迟分位数 + 样本总量
function getAdminSummary(e) {
  if (!requireMonitorAdmin(e)) return e.json(403, { code: 'FORBIDDEN' });
  try {
    var out = { now: new Date().toISOString(), targets: [] };
    for (var i = 0; i < PUBLIC_TARGETS.length; i++) {
      var meta = PUBLIC_TARGETS[i];
      var latest = null;
      try { latest = latestSample($app.dao(), meta.target); } catch (_) {}
      out.targets.push({
        key: meta.key,
        target: meta.target,
        label: meta.label,
        latest: latest ? {
          ok: latest.getBool('ok'),
          latencyMs: latest.getInt('latency_ms'),
          statusCode: latest.getInt('status_code'),
          error: latest.getString('error'),
          at: latest.getString('created'),
        } : null,
        h24: aggregate($app.dao(), meta.target, 24 * 3600 * 1000),
        d7: aggregate($app.dao(), meta.target, 7 * 24 * 3600 * 1000),
      });
    }
    return e.json(200, out);
  } catch (err) {
    console.error('[monitor] operation=admin-summary result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

// 后台明细:按 5 分钟桶聚合的时间序列(图表用)+ 最近失败样本(含错误详情)
function getAdminSeries(e) {
  if (!requireMonitorAdmin(e)) return e.json(403, { code: 'FORBIDDEN' });
  try {
    var hours = Number(e.queryParam('hours') || 24);
    if (!isFinite(hours) || hours < 1) hours = 24;
    if (hours > 168) hours = 168;
    var targetFilter = String(e.queryParam('target') || '').trim();
    var cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ');

    var filter = 'created >= {:cutoff}';
    var params = { cutoff: cutoff };
    if (/^[a-z0-9_]+$/.test(targetFilter)) {
      filter += ' && target = {:target}';
      params.target = targetFilter;
    }
    var rows = $app.dao().findRecordsByFilter('monitor_samples', filter, 'created', 30000, 0, params);

    var bucketMs = 5 * 60 * 1000;
    var series = {}; // target -> bucketStart -> {sum, count, ok}
    var failures = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var t = r.getString('target');
      var at = Date.parse(r.getString('created').replace(' ', 'T'));
      if (!isFinite(at)) continue;
      var b = Math.floor(at / bucketMs) * bucketMs;
      var key = t + '|' + b;
      if (!series[key]) series[key] = { target: t, bucket: b, sum: 0, count: 0, ok: 0 };
      series[key].sum += r.getInt('latency_ms');
      series[key].count += 1;
      if (r.getBool('ok')) series[key].ok += 1;
      if (!r.getBool('ok') && failures.length < 100) {
        failures.push({ target: t, at: r.getString('created'), statusCode: r.getInt('status_code'), latencyMs: r.getInt('latency_ms'), error: r.getString('error') });
      }
    }
    var buckets = [];
    for (var k in series) {
      var s = series[k];
      buckets.push({ target: s.target, bucket: new Date(s.bucket).toISOString(), avgMs: Math.round(s.sum / s.count), okRatio: Math.round((s.ok / s.count) * 1000) / 1000, count: s.count });
    }
    buckets.sort(function (a, b) { return a.bucket < b.bucket ? -1 : 1; });
    failures.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return e.json(200, { hours: hours, bucketMinutes: 5, buckets: buckets, failures: failures.slice(0, 50) });
  } catch (err) {
    console.error('[monitor] operation=admin-series result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

// 后台主机性能序列:5 分钟桶均值(cpu/mem/disk/net/load),含内存绝对值(仅后台)
function getAdminHostSeries(e) {
  if (!requireMonitorAdmin(e)) return e.json(403, { code: 'FORBIDDEN' });
  try {
    var hours = Number(e.queryParam('hours') || 24);
    if (!isFinite(hours) || hours < 1) hours = 24;
    if (hours > 168) hours = 168;
    var cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ');
    var rows = $app.dao().findRecordsByFilter('monitor_host_samples', 'created >= {:cutoff}', 'created', 11000, 0, { cutoff: cutoff });

    var bucketMs = 5 * 60 * 1000;
    var buckets = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var at = Date.parse(r.getString('created').replace(' ', 'T'));
      if (!isFinite(at)) continue;
      var b = Math.floor(at / bucketMs) * bucketMs;
      if (!buckets[b]) buckets[b] = { n: 0, cpu: 0, mem: 0, disk: 0, rx: 0, tx: 0, load: 0, memUsed: 0, memTotal: 0 };
      var bk = buckets[b];
      bk.n++;
      bk.cpu += Number(r.get('cpu_pct') || 0);
      bk.mem += Number(r.get('mem_pct') || 0);
      bk.disk += Number(r.get('disk_pct') || 0);
      bk.rx += Number(r.get('net_rx_kbps') || 0);
      bk.tx += Number(r.get('net_tx_kbps') || 0);
      bk.load += Number(r.get('load1') || 0);
      bk.memUsed += Number(r.get('mem_used_mb') || 0);
      bk.memTotal += Number(r.get('mem_total_mb') || 0);
    }
    var out = [];
    for (var k in buckets) {
      var v = buckets[k];
      out.push({
        bucket: new Date(Number(k)).toISOString(),
        cpuPct: Math.round((v.cpu / v.n) * 10) / 10,
        memPct: Math.round((v.mem / v.n) * 10) / 10,
        diskPct: Math.round((v.disk / v.n) * 10) / 10,
        rxKbps: Math.round(v.rx / v.n),
        txKbps: Math.round(v.tx / v.n),
        load1: Math.round((v.load / v.n) * 100) / 100,
        memUsedMb: Math.round(v.memUsed / v.n),
        memTotalMb: Math.round(v.memTotal / v.n),
        count: v.n,
      });
    }
    out.sort(function (a, b) { return a.bucket < b.bucket ? -1 : 1; });

    var latest = latestHostSample($app.dao());
    return e.json(200, {
      hours: hours,
      bucketMinutes: 5,
      latest: latest ? {
        cpuPct: Math.round(latest.get('cpu_pct') * 10) / 10,
        memPct: Math.round(latest.get('mem_pct') * 10) / 10,
        memUsedMb: Math.round(latest.get('mem_used_mb')),
        memTotalMb: Math.round(latest.get('mem_total_mb')),
        rxKbps: Math.round(latest.get('net_rx_kbps')),
        txKbps: Math.round(latest.get('net_tx_kbps')),
        diskPct: Math.round(latest.get('disk_pct') * 10) / 10,
        load1: Math.round(latest.get('load1') * 100) / 100,
        at: latest.getString('created'),
      } : null,
      buckets: out,
    });
  } catch (err) {
    console.error('[monitor] operation=admin-host result=ERROR detail=' + String(err && err.message || err).slice(0, 120));
    return e.json(503, { code: 'MONITOR_UNAVAILABLE' });
  }
}

// 供 protection_lib 等兄弟模块复用的内部判定
function isInternalRequest(e) {
  return isInternalCaller(clientIpOf(e && e.httpContext ? e.httpContext : e));
}

module.exports = {
  runProbes: runProbes,
  cleanupExpired: cleanupExpired,
  getPublicStatus: getPublicStatus,
  getAdminSummary: getAdminSummary,
  getAdminSeries: getAdminSeries,
  saveHostMetrics: saveHostMetrics,
  getAdminHostSeries: getAdminHostSeries,
  requireMonitorAdmin: requireMonitorAdmin,
  isInternalRequest: isInternalRequest,
};
