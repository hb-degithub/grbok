'use strict';

var gateway = require('./mail_gateway.js');
var stepUp = require('./admin_step_up.js');
var smtpConfig = require('./mail_smtp_config.js');
var mailTemplates = require('./mail_templates.js');

var QUEUE_STATUSES = ['pending', 'processing', 'retry', 'sent', 'failed', 'cancelled'];
var LOG_RESULTS = ['sent', 'failed'];
var MAX_PAGE_SIZE = 100;
var DEFAULT_PAGE_SIZE = 25;

function apiError(status, code) {
  throw new ApiError(status, code);
}

function requireTrustedAdminIp(c) {
  var configured = String($os.getenv('ADMIN_IP') || '').split(/[\s,]+/).filter(Boolean);
  if (configured.length === 0) return; // 未配置白名单 = 不启用 IP 检查（后台访问由 super_admin + step-up 保护）
  var actual = require('./client_ip.js').clientIp(c);
  if (!actual || configured.indexOf(actual) === -1) apiError(403, 'ADMIN_NETWORK_DENIED');
}

function integerParam(value, fallback, min, max) {
  var num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) return fallback;
  return num;
}

function stringParam(value) {
  var text = String(value || '').trim();
  return text;
}

function inSet(value, allowed) {
  var v = String(value || '').trim();
  return v && allowed.indexOf(v) !== -1 ? v : '';
}

function maskRecipient(email) {
  var text = String(email || '').trim();
  if (!text) return '';
  var at = text.indexOf('@');
  if (at < 1) return '***';
  var local = text.slice(0, at);
  var domain = text.slice(at + 1);
  var visible = local.slice(0, Math.min(2, local.length));
  return visible + '***@' + domain;
}

function isoToMillis(value) {
  if (!value) return 0;
  return Date.parse(String(value).replace(' ', 'T')) || 0;
}

function nowMillisMinus24h() {
  return Date.now() - 24 * 60 * 60 * 1000;
}

function countByFilter(dao, collection, filter, params) {
  try {
    var rows = dao.findRecordsByFilter(collection, filter, '', 500, 0, params || {});
    return rows.length;
  } catch (_) {
    return 0;
  }
}

function overview(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var dao = $app.dao();
  var sinceMs = nowMillisMinus24h();
  var sinceIso = new Date(sinceMs).toISOString().replace('T', ' ');

  var gatewayStatus = null;
  try {
    gatewayStatus = gateway.status();
  } catch (error) {
    gatewayStatus = { configured: false, error: String(error && error.message || 'unavailable') };
  }

  var sent24h = 0;
  var failed24h = 0;
  try {
    var sentRows = dao.findRecordsByFilter(
      'mail_delivery_logs',
      'created >= {:since} && result = {:result}',
      '', 500, 0,
      { since: sinceIso, result: 'sent' }
    );
    sent24h = sentRows.length;
  } catch (_) {}
  try {
    var failedRows = dao.findRecordsByFilter(
      'mail_delivery_logs',
      'created >= {:since} && result = {:result}',
      '', 500, 0,
      { since: sinceIso, result: 'failed' }
    );
    failed24h = failedRows.length;
  } catch (_) {}

  var pending = countByFilter(dao, 'mail_outbox', 'status = "pending"', {});
  var processing = countByFilter(dao, 'mail_outbox', 'status = "processing"', {});
  var retry = countByFilter(dao, 'mail_outbox', 'status = "retry"', {});
  var failedOutbox = countByFilter(dao, 'mail_outbox', 'status = "failed"', {});

  var total24h = sent24h + failed24h;
  var successRate = total24h > 0 ? Math.round((sent24h / total24h) * 100) : 0;

  return c.json(200, {
    gateway: gatewayStatus,
    summary: {
      sent_24h: sent24h,
      failed_24h: failed24h,
      success_rate: successRate,
      pending: pending,
      processing: processing,
      retry: retry,
      failed_outbox: failedOutbox,
    },
    checked_at: new Date().toISOString(),
  });
}

function queue(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var page = integerParam(c.queryParam('page'), 1, 1, 1000);
  var perPage = integerParam(c.queryParam('perPage'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  var status = inSet(c.queryParam('status'), QUEUE_STATUSES);
  var category = stringParam(c.queryParam('category'));

  var filter = 'id != ""';
  var params = {};
  if (status) { filter = 'status = {:status}'; params.status = status; }
  if (category) {
    filter = filter === 'id != ""' ? 'category = {:category}' : filter + ' && category = {:category}';
    params.category = category;
  }

  var offset = (page - 1) * perPage;
  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter('mail_outbox', filter, '-created', perPage, offset, params);
  } catch (_) {}

  var items = rows.map(function (r) {
    return {
      id: r.id,
      status: r.getString('status'),
      category: r.getString('category'),
      template_key: r.getString('template_key'),
      recipient_masked: maskRecipient(r.getString('recipient')),
      attempt: r.getInt('attempt'),
      next_attempt_at: r.getString('next_attempt_at') || '',
      last_error_class: r.getString('last_error_class') || '',
      created: r.getString('created') || '',
    };
  });

  return c.json(200, { items: items, page: page, perPage: perPage });
}

function logs(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var page = integerParam(c.queryParam('page'), 1, 1, 1000);
  var perPage = integerParam(c.queryParam('perPage'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  var result = inSet(c.queryParam('result'), LOG_RESULTS);
  var category = stringParam(c.queryParam('category'));

  var filter = 'id != ""';
  var params = {};
  if (result) { filter = 'result = {:result}'; params.result = result; }
  if (category) {
    filter = filter === 'id != ""' ? 'category = {:category}' : filter + ' && category = {:category}';
    params.category = category;
  }

  var offset = (page - 1) * perPage;
  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter('mail_delivery_logs', filter, '-created', perPage, offset, params);
  } catch (_) {}

  var items = rows.map(function (r) {
    return {
      id: r.id,
      event_id: r.getString('event_id'),
      category: r.getString('category'),
      source_kind: r.getString('source_kind'),
      result: r.getString('result'),
      duration_ms: r.getInt('duration_ms'),
      attempt: r.getInt('attempt'),
      error_class: r.getString('error_class') || '',
      archive_batch_id: r.getString('archive_batch_id') || '',
      created: r.getString('created') || '',
    };
  });

  return c.json(200, { items: items, page: page, perPage: perPage });
}

function verify(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var result = null;
  var error = null;
  try {
    result = gateway.verify();
  } catch (e) {
    error = String(e && e.code || e && e.message || 'verification failed');
  }

  var statusView = null;
  try { statusView = gateway.status(); } catch (_) {}

  return c.json(200, {
    verified: result !== null,
    gateway: statusView,
    verified_at: result ? result.verifiedAt : '',
    error: error,
    checked_at: new Date().toISOString(),
  });
}

// GET /api/blog-admin/mail/smtp — 脱敏回显当前后台 SMTP 配置
function smtpRead(c) {
  requireTrustedAdminIp(c);
  var secure = stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });
  void secure;
  return c.json(200, smtpConfig.readPublic($app.dao()));
}

// PUT /api/blog-admin/mail/smtp — 保存后台 SMTP 配置（密码加密存储，留空则保留原密码）
function smtpSave(c) {
  requireTrustedAdminIp(c);
  var secure = stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });
  var input;
  try {
    input = JSON.parse(readerToString(c.request().body, 8193) || '{}');
  } catch (_) {
    apiError(400, 'INVALID_REQUEST');
  }
  var saved = smtpConfig.save($app.dao(), input, secure.actorId);
  return c.json(200, saved);
}

function templates(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter('mail_templates', 'is_current = true', 'category,key', 100, 0, {});
  } catch (_) {}

  var items = rows.map(function (r) {
    var variablesJson = '';
    var requiredVariablesJson = '';
    try { variablesJson = r.getString('variables_json') || ''; } catch (_) {}
    try { requiredVariablesJson = r.getString('required_variables_json') || ''; } catch (_) {}
    var variables = [];
    var required = [];
    try { variables = JSON.parse(variablesJson); } catch (_) {}
    try { required = JSON.parse(requiredVariablesJson); } catch (_) {}
    return {
      id: r.id,
      key: r.getString('key'),
      name: r.getString('name'),
      category: r.getString('category'),
      version: r.getInt('version'),
      is_current: r.getBool('is_current'),
      builtin: r.getBool('builtin'),
      subject_template: r.getString('subject_template') || '',
      variables: Array.isArray(variables) ? variables : [],
      required_variables: Array.isArray(required) ? required : [],
      content: (function () { try { return JSON.parse(r.getString('content_json') || '{}'); } catch (_) { return {}; } })(),
    };
  });

  return c.json(200, { items: items });
}

function rules(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var dao = $app.dao();
  var policies = [];
  try {
    var policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 100, 0, {});
    policies = policyRows.map(function (r) {
      return {
        key: r.getString('key'),
        limit: r.getInt('limit'),
        window_seconds: r.getInt('window_seconds'),
        version: r.getInt('version'),
      };
    });
  } catch (_) {}

  var mailPolicies = policies.filter(function (p) {
    return p.key.indexOf('mail') !== -1 || p.key.indexOf('outbound') !== -1 || p.key.indexOf('guestbook') !== -1 || p.key.indexOf('comment') !== -1;
  });

  return c.json(200, {
    policies: mailPolicies,
    system_sources: [
      { key: 'comment_new', label: '新评论通知', source: 'Outbox', editable: false },
      { key: 'account_retention_notice', label: '账户保留提醒', source: 'Outbox', editable: false },
      { key: 'account_verification', label: '注册验证', source: '同步', editable: false },
      { key: 'account_password_reset', label: '密码重置', source: '同步', editable: false },
      { key: 'account_email_change', label: '邮箱变更', source: '同步', editable: false },
      { key: 'reader_otp', label: 'Reader 验证码', source: '同步', editable: false },
      { key: 'ops_alert', label: '运维告警', source: '宿主机 CLI', editable: false },
    ],
    note: '当前为只读视图；规则写入需通过安全策略端点在硬边界内修改。',
  });
}

function suppress(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var rows = [];
  try {
    rows = $app.dao().findRecordsByFilter(
      'mail_outbox',
      'status = "failed" && last_error_class = "RECIPIENT_PERMANENT"',
      '-created', 100, 0, {}
    );
  } catch (_) {}

  var items = rows.map(function (r) {
    return {
      id: r.id,
      category: r.getString('category'),
      recipient_masked: maskRecipient(r.getString('recipient')),
      last_error_class: r.getString('last_error_class') || '',
      created: r.getString('created') || '',
    };
  });

  return c.json(200, { items: items, note: '仅展示因永久地址错误而最终失败的记录；解除抑制需重新触发合法业务事件。' });
}


// PUT /api/blog-admin/mail/templates — 编辑模板（主题/标题/段落/页脚/按钮文字）
function templateUpdate(c) {
  requireTrustedAdminIp(c);
  stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var input;
  try { input = JSON.parse(readerToString(c.request().body, 65537) || '{}'); } catch (_) { apiError(400, 'INVALID_REQUEST'); }

  var key = String(input.key || '').trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) apiError(400, 'INVALID_TEMPLATE_KEY');

  var dao = $app.dao();
  var rows = dao.findRecordsByFilter('mail_templates', 'key = {:key} && is_current = true', '-created', 1, 0, { key: key });
  if (!rows || !rows.length) apiError(404, 'TEMPLATE_NOT_FOUND');
  var record = rows[0];

  var subject = String(input.subject_template || '').trim();
  if (!subject || subject.length > 200) apiError(400, 'INVALID_SUBJECT');
  var title = String(input.title || '').trim();
  if (!title || title.length > 200) apiError(400, 'INVALID_TITLE');
  var preheader = String(input.preheader || '');
  var footer = String(input.footer || '');
  var paragraphs = input.paragraphs;
  if (!Array.isArray(paragraphs) || paragraphs.length === 0 || paragraphs.length > 10) apiError(400, 'INVALID_PARAGRAPHS');
  for (var i = 0; i < paragraphs.length; i++) {
    paragraphs[i] = String(paragraphs[i] || '').trim();
    if (!paragraphs[i] || paragraphs[i].length > 1000) apiError(400, 'INVALID_PARAGRAPHS');
  }

  var content;
  try { content = JSON.parse(record.getString('content_json') || '{}'); } catch (_) { content = {}; }
  content.preheader = preheader;
  content.title = title;
  content.paragraphs = paragraphs;
  content.footer = footer;
  if (content.action && typeof content.action === 'object') {
    var label = String(input.action_label || '').trim();
    if (label && label.length <= 40) content.action.label = label; // 仅允许改按钮文字，urlVariable 不动
  }

  // 校验 required 变量的占位符仍出现在文案里（action 的 URL 变量除外）
  var required = [];
  try { required = JSON.parse(record.getString('required_variables_json') || '[]'); } catch (_) {}
  var urlVar = content.action && typeof content.action === 'object' ? String(content.action.urlVariable || '') : '';
  var haystack = [subject, preheader, title, paragraphs.join('\n'), footer].join('\n');
  for (var j = 0; j < required.length; j++) {
    var reqName = String(required[j]);
    if (reqName && reqName === urlVar) continue;
    if (haystack.indexOf('{{' + reqName + '}}') === -1) apiError(400, 'MISSING_REQUIRED_VARIABLE: ' + reqName);
  }

  record.set('subject_template', subject);
  record.set('content_json', JSON.stringify(content));
  dao.saveRecord(record);
  return c.json(200, { saved: true, key: key });
}

// 模板变量的测试示例值
function sampleVariableValue(name) {
  var map = {
    code: '123456', displayName: '测试用户', expiresMinutes: '10',
    email: 'reader@example.com', name: '测试用户', siteName: '个人博客',
  };
  if (map[name]) return map[name];
  if (/url/i.test(name)) {
    var site = String($os.getenv('PUBLIC_SITE_URL') || '').trim() || 'https://hlydwz.com';
    return site.replace(/\/$/, '') + '/';
  }
  return 'sample-' + name;
}

// POST /api/blog-admin/mail/test — 用指定模板向当前管理员邮箱发送一封测试邮件
function sendTest(c) {
  requireTrustedAdminIp(c);
  var secure = stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });

  var input;
  try { input = JSON.parse(readerToString(c.request().body, 8193) || '{}'); } catch (_) { apiError(400, 'INVALID_REQUEST'); }
  var key = String(input.key || '').trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) apiError(400, 'INVALID_TEMPLATE_KEY');

  var to = secure.actor ? String(secure.actor.getString('email') || '').trim() : '';
  if (!to) apiError(400, 'ADMIN_EMAIL_UNAVAILABLE');

  var rows = $app.dao().findRecordsByFilter('mail_templates', 'key = {:key} && is_current = true', '-created', 1, 0, { key: key });
  if (!rows || !rows.length) apiError(404, 'TEMPLATE_NOT_FOUND');
  var record = rows[0];

  var declared = [];
  try { declared = JSON.parse(record.getString('variables_json') || '[]'); } catch (_) {}
  var vars = {};
  var declaredSet = {};
  for (var i = 0; i < declared.length; i++) {
    var name = String(declared[i]);
    declaredSet[name] = true;
    vars[name] = sampleVariableValue(name);
  }
  if (input.vars && typeof input.vars === 'object' && !Array.isArray(input.vars)) {
    for (var k in input.vars) {
      if (Object.prototype.hasOwnProperty.call(input.vars, k) && declaredSet[k]) {
        vars[k] = String(input.vars[k]).slice(0, 500);
      }
    }
  }

  var rendered;
  try {
    rendered = mailTemplates.render(key, vars);
  } catch (e) {
    return c.json(200, { sent: false, stage: 'render', error: String(e && e.message || e) });
  }

  try {
    var result = gateway.send({
      requestId: 'test-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      messageId: 'testmsg-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      category: rendered.category,
      to: to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return c.json(200, { sent: true, to: maskRecipient(to), request_id: result.requestId, subject: rendered.subject });
  } catch (e) {
    return c.json(200, { sent: false, stage: 'send', error: String(e && e.code || e && e.message || e), to: maskRecipient(to) });
  }
}

module.exports = {
  overview: overview,
  queue: queue,
  logs: logs,
  verify: verify,
  templates: templates,
  rules: rules,
  suppress: suppress,
  smtpRead: smtpRead,
  smtpSave: smtpSave,
  templateUpdate: templateUpdate,
  sendTest: sendTest,
};
