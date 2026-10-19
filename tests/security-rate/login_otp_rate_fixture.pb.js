/// <reference path="../../pb_local/pb/pb_data/types.d.ts" />

// 2026-10-14 限流加固测试夹具（非生产）。
// 由测试脚本复制为 pb_hooks/security_rate_fixture.pb.js 后加载；
// 只提供"造数据 + 读证据"能力，不改变任何业务语义。
//
// 重要（PB 0.22 JSVM 实证）：routerAdd 回调按源码字符串在请求级 runtime 里重新 eval，
// **访问不到本文件 IIFE 的闭包变量**（blog_auth.pb.js:8-10 已记录同一陷阱）。
// 因此每个 handler 必须自包含：解析 body、查库、require 全部写在回调内部。
(function () {
  // 清空限流桶（用例之间隔离）
  routerAdd('POST', '/api/test/login-rate/reset', function (c) {
    $app.dao().runInTransaction(function (txDao) {
      var rows = txDao.findRecordsByFilter('security_rate_buckets', 'id != ""', '', 500, 0);
      for (var i = 0; i < rows.length; i++) txDao.deleteRecord(rows[i]);
    });
    return c.json(200, { ok: true });
  });

  // 策略表健康度 + 4 个新键的实际取值（迁移是否注册成功）
  routerAdd('GET', '/api/test/login-rate/policy', function (c) {
    var store = require(__hooks + '/lib/security_policy_store.js');
    var current = store.getRatePolicySet($app.dao());
    var keys = ['login_ip', 'login_email_ip', 'login_email_any', 'otp_verify_ip'];
    var values = {};
    for (var i = 0; i < keys.length; i++) {
      var policy = current.policies[keys[i]];
      values[keys[i]] = policy ? { limit: policy.limit, windowSeconds: policy.windowSeconds } : null;
    }
    var dbKeys = [];
    var rows = $app.dao().findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 300, 0);
    for (var r = 0; r < rows.length; r++) dbKeys.push(String(rows[r].get('key')));
    return c.json(200, {
      ok: true,
      degraded: current.degraded,
      version: current.version,
      defaultsKeyCount: Object.keys(store.DEFAULTS).length,
      dbRowCount: dbKeys.length,
      policies: values,
    });
  });

  // 桶内事件数（证据用）
  routerAdd('GET', '/api/test/login-rate/buckets', function (c) {
    var rate = require(__hooks + '/lib/security_rate_limit.js');
    var ip = String(c.queryParam('ip') || '');
    var email = String(c.queryParam('email') || '');
    var pairs = [];
    if (ip) pairs.push(['login_ip', ip]);
    if (ip && email) pairs.push(['login_email_ip', email + '|' + ip]);
    if (email) pairs.push(['login_email_any', email]);
    if (ip) pairs.push(['otp_verify_ip', ip]);
    var counts = {};
    for (var i = 0; i < pairs.length; i++) {
      var records = $app.dao().findRecordsByFilter(
        'security_rate_buckets',
        'policy = {:policy} && subject_hash = {:hash}',
        '', 2, 0,
        { policy: pairs[i][0], hash: rate._subjectHash(pairs[i][0], pairs[i][1]) },
      );
      counts[pairs[i][0]] = records.length ? JSON.parse(String(records[0].get('events_json'))).length : 0;
    }
    return c.json(200, { ok: true, counts: counts });
  });

  // 造一个已验证的 users 记录（公共注册入口 createRule = null，只能从内部造）
  routerAdd('POST', '/api/test/login-rate/seed-user', function (c) {
    var body = {};
    try { body = JSON.parse(readerToString(c.request().body, 8192) || '{}') || {}; } catch (_) { body = {}; }
    var email = String(body.email || '').trim().toLowerCase();
    var password = String(body.password || '');
    var role = String(body.role || 'reader');
    if (!email || !password) return c.json(400, { ok: false, error: 'INVALID_REQUEST' });
    var dao = $app.dao();
    var record = null;
    try { record = dao.findFirstRecordByFilter('users', 'email = {:email}', { email: email }); } catch (_) { record = null; }
    if (!record) {
      record = new Record(dao.findCollectionByNameOrId('users'));
      record.set('email', email);
      record.set('name', 'Rate Probe');
    }
    record.set('role', role);
    record.set('verified', true);
    record.setPassword(password);
    dao.saveRecord(record);
    var hash = '';
    try { hash = String(record.passwordHash() || ''); } catch (_) { hash = ''; }
    return c.json(200, {
      ok: true,
      id: record.id,
      email: record.getString('email'),
      passwordValid: record.validatePassword(password),
      hashLength: hash.length,
    });
  });

  // 造一个 superuser（admins 链路回归用）
  routerAdd('POST', '/api/test/login-rate/seed-admin', function (c) {
    var body = {};
    try { body = JSON.parse(readerToString(c.request().body, 8192) || '{}') || {}; } catch (_) { body = {}; }
    var email = String(body.email || '').trim().toLowerCase();
    var password = String(body.password || '');
    if (!email || !password) return c.json(400, { ok: false, error: 'INVALID_REQUEST' });
    var dao = $app.dao();
    var admin = null;
    try { admin = dao.findAdminByEmail(email); } catch (_) { admin = null; }
    if (!admin) { admin = new Admin(); admin.email = email; }
    admin.setPassword(password);
    dao.saveAdmin(admin);
    return c.json(200, { ok: true, id: admin.id, email: String(admin.email), passwordValid: admin.validatePassword(password) });
  });

  // 造一条 challenge 并预先知道明文码（OTP 正例用；生产上码是随机的且只发邮件）
  routerAdd('POST', '/api/test/login-rate/seed-otp', function (c) {
    var body = {};
    try { body = JSON.parse(readerToString(c.request().body, 8192) || '{}') || {}; } catch (_) { body = {}; }
    var email = String(body.email || '').trim().toLowerCase();
    var code = String(body.code || '');
    var challengeId = String(body.challengeId || '');
    if (!/^[0-9]{6}$/.test(code) || !/^[A-Za-z0-9_-]{20,64}$/.test(challengeId)) {
      return c.json(400, { ok: false, error: 'INVALID_REQUEST' });
    }
    var crypto = require(__hooks + '/lib/mail_crypto.js');
    var dao = $app.dao();
    var user = null;
    try { user = dao.findFirstRecordByFilter('users', 'email = {:email}', { email: email }); } catch (_) { user = null; }
    if (!user) return c.json(400, { ok: false, error: 'USER_NOT_FOUND' });
    var secret = String($os.getenv('MAIL_HASH_SECRET') || '').trim();
    var record = new Record(dao.findCollectionByNameOrId('auth_otp_challenges'));
    record.set('challenge_id', challengeId);
    record.set('user', user.id);
    record.set('email_hash', crypto.hashPrivate('email', email));
    record.set('ip_hash', crypto.hashPrivate('ip', '127.0.0.1'));
    record.set('code_hash', $security.hs256('otp-code:' + challengeId + ':' + code, secret));
    record.set('expires_at', new Date(Date.now() + 600000).toISOString().replace('T', ' '));
    record.set('attempts', 0);
    record.set('consumed_at', '');
    dao.saveRecord(record);
    return c.json(200, { ok: true, id: record.id, challengeId: challengeId, userId: user.id });
  });

  // challenge 的尝试次数/作废状态（验证 "5 次作废" 语义未回归）
  routerAdd('GET', '/api/test/login-rate/challenge', function (c) {
    var id = String(c.queryParam('challengeId') || '');
    var rows = $app.dao().findRecordsByFilter('auth_otp_challenges', 'challenge_id = {:id}', '', 1, 0, { id: id });
    if (!rows.length) return c.json(404, { ok: false, error: 'NOT_FOUND' });
    return c.json(200, {
      ok: true,
      attempts: rows[0].getInt('attempts'),
      consumed: String(rows[0].getString('consumed_at') || '') !== '',
    });
  });

  // 清空 page_views（track-view 用例之间隔离）
  routerAdd('POST', '/api/test/login-rate/reset-views', function (c) {
    $app.dao().runInTransaction(function (txDao) {
      var rows = txDao.findRecordsByFilter('page_views', 'id != ""', '', 500, 0);
      for (var i = 0; i < rows.length; i++) txDao.deleteRecord(rows[i]);
    });
    return c.json(200, { ok: true });
  });

  // page_views 中某个 path 的落库条数（区分 400 拒绝 / 202 写入）
  routerAdd('GET', '/api/test/login-rate/views', function (c) {
    var path = String(c.queryParam('path') || '');
    var rows = $app.dao().findRecordsByFilter('page_views', 'path = {:path}', '', 200, 0, { path: path });
    var total = $app.dao().findRecordsByFilter('page_views', 'id != ""', '', 500, 0);
    return c.json(200, { ok: true, matches: rows.length, total: total.length });
  });

  // 穷举 isValidPath 判定表（修复后 = 白名单实现；修复前 stats_lib 未导出该函数）
  routerAdd('POST', '/api/test/login-rate/paths', function (c) {
    var stats = require(__hooks + '/lib/stats_lib.js');
    var body = {};
    try { body = JSON.parse(readerToString(c.request().body, 65535) || '{}') || {}; } catch (_) { body = {}; }
    var inputs = body.paths;
    if (!inputs || typeof inputs.length !== 'number') return c.json(400, { ok: false, error: 'INVALID_REQUEST' });
    var exported = typeof stats.isValidPath === 'function';
    var results = [];
    for (var i = 0; i < inputs.length; i++) {
      var accepted = false;
      if (exported) {
        try { accepted = stats.isValidPath(inputs[i]); } catch (_) { accepted = false; }
      }
      results.push({ path: inputs[i], accepted: accepted });
    }
    return c.json(200, {
      ok: true,
      exported: exported,
      maxPathLength: stats.MAX_PATH_LENGTH || null,
      results: results,
    });
  });
})();
