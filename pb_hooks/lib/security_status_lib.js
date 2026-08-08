'use strict';

// 安全防护状态查询业务逻辑
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）

function getSecurityStatus(e) {
  // 检查管理员权限
  var auth = e.auth;
  if (!auth || !auth.id) {
    return e.json(401, { code: 'UNAUTHORIZED' });
  }
  var role = auth.getString('role');
  if (role !== 'admin' && role !== 'super_admin') {
    return e.json(403, { code: 'FORBIDDEN' });
  }

  // 读取限流策略
  var policies = [];
  try {
    var policyRecords = $app.dao().findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
    for (var i = 0; i < policyRecords.length; i++) {
      var p = policyRecords[i];
      policies.push({
        key: p.getString('key'),
        limit: p.getInt('limit'),
        windowSeconds: p.getInt('windowSeconds'),
      });
    }
  } catch (_) {}

  // 读取限流桶状态（从 globalThis 共享的桶）
  var buckets = [];
  try {
    var loginBuckets = globalThis.loginRateBuckets || {};
    var lockouts = globalThis.loginLockouts || {};
    var now = Date.now();

    for (var key in loginBuckets) {
      var bucket = loginBuckets[key];
      if (bucket && bucket.length > 0) {
        buckets.push({
          key: key,
          count: bucket.length,
          lastTriggered: new Date(bucket[bucket.length - 1]).toISOString(),
        });
      }
    }

    for (var key in lockouts) {
      if (lockouts[key] > now) {
        buckets.push({
          key: key,
          locked: true,
          lockUntil: new Date(lockouts[key]).toISOString(),
        });
      }
    }
  } catch (_) {}

  // 统计各集合的记录数
  var stats = {};
  try {
    // 使用计数 API 而非 limit=1 查询
    stats.comments = $app.dao().countRecords('comments');
    stats.pendingComments = $app.dao().countRecordsWithFilter('comments', 'status = "pending"');
    stats.reports = $app.dao().countRecords('comment_reports');
    stats.pendingReports = $app.dao().countRecordsWithFilter('comment_reports', 'status = "pending"');
  } catch (_) {
    // 回退到 limit=500 查询
    try {
      stats.comments = $app.dao().findRecordsByFilter('comments', 'id != ""', '', 500, 0).length;
      stats.pendingComments = $app.dao().findRecordsByFilter('comments', 'status = "pending"', '', 500, 0).length;
      stats.reports = $app.dao().findRecordsByFilter('comment_reports', 'id != ""', '', 500, 0).length;
      stats.pendingReports = $app.dao().findRecordsByFilter('comment_reports', 'status = "pending"', '', 500, 0).length;
    } catch (_) {}
  }

  return e.json(200, {
    policies: policies,
    buckets: buckets,
    stats: stats,
    timestamp: new Date().toISOString(),
  });
}

function getSecurityEvents(e) {
  // 检查管理员权限
  var auth = e.auth;
  if (!auth || !auth.id) {
    return e.json(401, { code: 'UNAUTHORIZED' });
  }
  var role = auth.getString('role');
  if (role !== 'admin' && role !== 'super_admin') {
    return e.json(403, { code: 'FORBIDDEN' });
  }

  // 读取最近的安全审计日志
  var events = [];
  try {
    var auditRecords = $app.dao().findRecordsByFilter('security_audit_log', 'id != ""', '-created', 20, 0);
    for (var i = 0; i < auditRecords.length; i++) {
      var r = auditRecords[i];
      events.push({
        id: r.id,
        action: r.getString('action'),
        actor: r.getString('actor'),
        target: r.getString('target'),
        detail: r.getString('detail'),
        created: r.getString('created'),
      });
    }
  } catch (_) {}

  return e.json(200, { events: events });
}

module.exports = {
  getSecurityStatus: getSecurityStatus,
  getSecurityEvents: getSecurityEvents,
};
