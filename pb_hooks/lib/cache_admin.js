'use strict';

// ESA 缓存刷新管理端业务逻辑（仅 super_admin 可用）
// 端点：config 读取/保存、purge 提交、tasks 记录查询（含状态同步）

var stepUp = require('./admin_step_up.js');
var audit = require('./admin_security_audit.js');
var rateLimit = require('./security_rate_limit.js');
var config = require('./cache_esa_config.js');
var gateway = require('./cache_esa_gateway.js');

var TASKS_COLLECTION = 'esa_purge_tasks';
var MAX_PURGE_URLS = 100;
var MAX_SYNC_PER_LIST = 5;

function error(code, statusCode, retryAfter) {
  var e = new Error(code);
  e.code = code;
  e.statusCode = statusCode;
  if (retryAfter) e.retryAfter = retryAfter;
  return e;
}

function secure(c, actionCode) {
  var security = stepUp.requireAdminStepUp(c, {
    requireVerifiedEmail: true,
    requireSuperAdmin: true,
    actionCode: actionCode,
  });
  security.writeAudit = audit.writeSecurityAudit;
  security.nowMs = Date.now();
  return security;
}

function body(c) {
  return JSON.parse(readerToString(c.request().body, 65536) || '{}');
}

// 管理写操作限频（与安全策略写操作共用 admin_security_write 策略桶）
function consumeAdminWrite(security) {
  var result;
  $app.dao().runInTransaction(function (txDao) {
    result = rateLimit.consume(txDao, {
      nowMs: security.nowMs,
      entries: [{ policyKey: 'admin_security_write', subject: security.actorId }],
    });
  });
  if (!result || typeof result.allowed !== 'boolean') {
    throw error('ESA_UNAVAILABLE', 503);
  }
  if (!result.allowed) {
    throw error('ESA_PURGE_RATE_LIMITED', 429, result.retryAfterSeconds);
  }
}

function allowedHost() {
  var raw = String($os.getenv('PUBLIC_SITE_URL') || '').trim();
  if (raw) {
    try {
      var value = raw.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      if (value) return value;
    } catch (_) {}
  }
  return 'hlydwz.com';
}

// 规范化与校验：仅允许本站域名；以 / 结尾归 directory，其余归 file
function normalizeUrls(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_PURGE_URLS) {
    throw error('INVALID_PURGE_URL', 400);
  }
  var host = allowedHost();
  var prefix = 'https://' + host;
  var seen = {};
  var files = [];
  var directories = [];
  for (var i = 0; i < input.length; i++) {
    var raw = typeof input[i] === 'string' ? input[i].trim() : '';
    if (!raw) continue;
    if (raw.indexOf('http://') === 0) raw = 'https://' + raw.slice(7);
    if (raw.indexOf(prefix) !== 0 && raw.indexOf(prefix + '/') !== 0) {
      throw error('INVALID_PURGE_URL', 400);
    }
    var rest = raw.slice(prefix.length);
    if (rest && rest.charAt(0) !== '/') throw error('INVALID_PURGE_URL', 400);
    if (/[\s#]/.test(raw)) throw error('INVALID_PURGE_URL', 400);
    var path = rest.split('?')[0] || '/';
    if (path.length > 500) throw error('INVALID_PURGE_URL', 400);
    if (seen[path]) continue;
    seen[path] = true;
    var url = prefix + path;
    if (path.charAt(path.length - 1) === '/') {
      directories.push(url);
    } else {
      files.push(url);
    }
  }
  if (!files.length && !directories.length) throw error('INVALID_PURGE_URL', 400);
  return { files: files, directories: directories };
}

function requireCredentials() {
  var credentials = config.resolve($app.dao());
  if (!credentials) throw error('ESA_NOT_CONFIGURED', 503);
  return credentials;
}

function writeTask(security, fields) {
  var record = new Record($app.dao().findCollectionByNameOrId(TASKS_COLLECTION));
  record.set('task_id', String(fields.taskId || ''));
  record.set('type', String(fields.type || ''));
  record.set('content', fields.content || []);
  record.set('status', String(fields.status || 'submitted'));
  record.set('message', String(fields.message || '').slice(0, 512));
  record.set('created_by', String(security.actorId || ''));
  $app.dao().saveRecord(record);
  return record;
}

function configRead(c) {
  secure(c, 'ESA_CONFIG_VIEWED');
  return c.json(200, config.readPublic($app.dao()));
}

function configSave(c) {
  var security = secure(c, 'ESA_CONFIG_UPDATED');
  consumeAdminWrite(security);
  var view = config.save($app.dao(), body(c), security.actorId);
  security.writeAudit($app.dao(), security, {
    actionCode: 'ESA_CONFIG_UPDATED',
    targetType: 'esa_cache',
    targetId: 'settings',
    after: { configured: view.configured, enabled: view.enabled, siteId: view.siteId },
  });
  return c.json(200, view);
}

function submitPurge(security, credentials, type, urls) {
  var taskId = '';
  try {
    var result = gateway.purge(credentials, type, urls);
    taskId = result.taskId;
  } catch (err) {
    var code = String(err && err.code || 'ESA_UPSTREAM_ERROR');
    writeTask(security, {
      type: type,
      content: urls,
      status: 'rejected',
      message: code,
    });
    throw error(code, Number(err && err.statusCode) || 503);
  }
  var record = writeTask(security, {
    taskId: taskId,
    type: type,
    content: urls,
    status: 'submitted',
  });
  return { taskId: taskId, recordId: record.id };
}

function purge(c) {
  var security = secure(c, 'ESA_CACHE_PURGED');
  consumeAdminWrite(security);
  var input = body(c);
  var credentials = requireCredentials();

  var submitted = [];
  if (input && input.type === 'purgeall') {
    submitted.push(submitPurge(security, credentials, 'purgeall', []));
  } else {
    var groups = normalizeUrls(input && input.urls);
    if (groups.files.length) {
      submitted.push(submitPurge(security, credentials, 'file', groups.files));
    }
    if (groups.directories.length) {
      submitted.push(submitPurge(security, credentials, 'directory', groups.directories));
    }
  }

  security.writeAudit($app.dao(), security, {
    actionCode: 'ESA_CACHE_PURGED',
    targetType: 'esa_cache',
    targetId: submitted.map(function (item) { return item.taskId; }).join(','),
    after: { tasks: submitted.length },
  });

  return c.json(200, {
    ok: true,
    tasks: submitted.map(function (item) {
      return { taskId: item.taskId, recordId: item.recordId, status: 'submitted' };
    }),
  });
}

function mapRemoteStatus(remote) {
  var status = String(remote && remote.status || '');
  if (status === 'Complete') return 'complete';
  if (status === 'Failed') return 'failed';
  return 'submitted';
}

function taskView(record) {
  return {
    id: record.id,
    taskId: String(record.getString('task_id') || ''),
    type: String(record.getString('type') || ''),
    content: record.get('content') || [],
    status: String(record.getString('status') || ''),
    message: String(record.getString('message') || ''),
    created: String(record.getString('created') || ''),
  };
}

function tasks(c) {
  secure(c, 'ESA_TASKS_VIEWED');
  var records = $app.dao().findRecordsByFilter(TASKS_COLLECTION, 'id != ""', '-created', 20, 0);

  // 对 submitted 状态的记录按需回源同步（DescribePurgeTasks），失败不阻断列表
  var synced = 0;
  var credentials = config.resolve($app.dao());
  if (credentials) {
    for (var i = 0; i < records.length && synced < MAX_SYNC_PER_LIST; i++) {
      var record = records[i];
      if (String(record.getString('status')) !== 'submitted') continue;
      var taskId = String(record.getString('task_id') || '');
      if (!taskId) continue;
      synced++;
      try {
        var remote = gateway.describeTasks(credentials, taskId);
        for (var j = 0; j < remote.length; j++) {
          if (String(remote[j].taskId) === taskId) {
            var next = mapRemoteStatus(remote[j]);
            if (next !== 'submitted') {
              record.set('status', next);
              if (next === 'failed' && remote[j].error) {
                record.set('message', String(remote[j].error).slice(0, 512));
              }
              $app.dao().saveRecord(record);
            }
            break;
          }
        }
      } catch (_) {}
    }
  }

  return c.json(200, {
    items: records.map(taskView),
  });
}

module.exports = {
  configRead: configRead,
  configSave: configSave,
  purge: purge,
  tasks: tasks,
};
