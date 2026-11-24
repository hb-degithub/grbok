'use strict';

// AI 管理路由业务逻辑（JSVM lib，必须自包含：lib 作用域内 __hooks 不存在，
// 因此 require 一律用相对路径；routerAdd 回调按源码重 eval，访问不到闭包）。
//
// 路由：
//   GET  /api/blog-admin/ai/settings   settingsRead     super_admin + 邮箱已验证
//   PUT  /api/blog-admin/ai/settings   settingsSave     super_admin + 邮箱已验证
//   POST /api/blog-admin/ai/test       testConnection   super_admin + 邮箱已验证
//   POST /api/blog-admin/ai/article    generateArticle  author/admin/super_admin
//   POST /api/blog-admin/ai/assist     assist           author/admin/super_admin
//
// 前台正文由 Markdown 渲染管线渲染（marked + highlight.js，并接入 katex / mermaid），再经
// set:html 注入；因此 article 的 content 是 Markdown 正文，JSON 外层结构保持不变
// （见 ARTICLE_SYSTEM_PROMPT）。

var aiConfig = require('./ai_config.js');
var aiClient = require('./ai_client.js');
var aiModeration = require('./ai_moderation.js');
var stepUp = require('./admin_step_up.js');
var rateLimit = require('./security_rate_limit.js');
var commentWorker = require('./ai_comment_worker.js');

var ADMIN_ROLES = ['author', 'admin', 'super_admin'];

var GUESTBOOK_COLLECTION = 'guestbook_messages';
// 留言 AI 审核回写字段（迁移 20261124120000_add_guestbook_ai_fields 引入）。
// 迁移未应用时这三个字段可能不存在，落库前用 schema 探测并在缺失时跳过写入。
var GUESTBOOK_AI_FIELDS = ['ai_verdict', 'ai_reason', 'ai_moderated'];
// guestbook_messages.status 的枚举是 show / hidden（见 20260718101000_create_guestbook_messages），
// 垃圾判定隐藏留言用 'hidden'，正常则回到 'show'；unsure 保持原状态交人工复核。
var GUESTBOOK_STATUS_VISIBLE = 'show';
var GUESTBOOK_STATUS_HIDDEN = 'hidden';
var GUESTBOOK_REASON_MAX = 480;

// 生成/辅助的字数档 -> (目标字数, maxTokens)
var LENGTH_PRESETS = {
  short: { words: 800, maxTokens: 3000 },
  medium: { words: 1500, maxTokens: 5000 },
  long: { words: 2500, maxTokens: 8000 },
};

var SLUG_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*$/;
var MAX_TOPIC_LEN = 500;
var MAX_OUTLINE_LEN = 2000;
var MAX_STYLE_LEN = 200;
var MAX_ASSIST_TITLE_LEN = 200;
var MAX_ASSIST_CONTENT_LEN = 50000;
var MAX_ASSIST_SELECTION_LEN = 10000;
var MAX_TAG_NAMES = 5;

function apiError(status, code) {
  throw new ApiError(status, code);
}

// 复制自 pb_hooks/lib/mail_admin.js:17-22 —— lib 作用域无法 require 该文件（会导致
// 循环依赖 + 拉入邮件网关），故同名同实现就地复制。
function requireTrustedAdminIp(c) {
  var configured = String($os.getenv('ADMIN_IP') || '').split(/[\s,]+/).filter(Boolean);
  if (configured.length === 0) return; // 未配置白名单 = 不启用 IP 检查（后台访问由 super_admin + step-up 保护）
  var actual = require('./client_ip.js').clientIp(c);
  if (!actual || configured.indexOf(actual) === -1) apiError(403, 'ADMIN_NETWORK_DENIED');
}

// 请求体读取：readerToString 是 PB 内置全局（types.d.ts:196），非项目实现。
function readBody(c, maxBytes) {
  var input;
  try {
    input = JSON.parse(readerToString(c.request().body, maxBytes) || '{}');
  } catch (_) {
    apiError(400, 'INVALID_REQUEST');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) apiError(400, 'INVALID_REQUEST');
  return input;
}

function text(value, maxLen) {
  var s = String(value == null ? '' : value).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function auditIp(c) {
  try {
    return String(require('./client_ip.js').clientIp(c) || '').slice(0, 45);
  } catch (_) {
    return '';
  }
}

function auditUserAgent(c) {
  try {
    return String(c.request().header.get('User-Agent') || '').slice(0, 200);
  } catch (_) {
    return '';
  }
}

// 审计日志：与 scheduled_publish.pb.js:28-43 同构；失败不影响主流程。
function writeAudit(c, actorId, action, targetCollection, targetId, summary) {
  try {
    var auditCollection = $app.dao().findCollectionByNameOrId('audit_logs');
    var log = new Record(auditCollection);
    log.set('actor', String(actorId || ''));
    log.set('action', String(action));
    log.set('target_collection', String(targetCollection || ''));
    log.set('target_id', String(targetId || ''));
    log.set('summary', String(summary || '').slice(0, 450));
    log.set('ip', auditIp(c));
    log.set('user_agent', auditUserAgent(c));
    $app.dao().saveRecord(log);
  } catch (e) {
    console.error('[ai-audit-write-failed] action=' + String(action));
  }
}

// 限流消费：单条目、事务内原子消费；store 降级/写入失败一律 fail closed 503。
function consumeQuota(policyKey, subject) {
  var decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: policyKey, subject: String(subject) }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    apiError(503, 'AI_UNAVAILABLE');
  }
  if (!decision.allowed) apiError(429, 'AI_RATE_LIMITED');
  return decision;
}

// 设置类路由：可信管理 IP + step-up（super_admin + 邮箱已验证）
function requireSuperAdminSecure(c) {
  requireTrustedAdminIp(c);
  return stepUp.requireAdminStepUp(c, { requireSuperAdmin: true, requireVerifiedEmail: true });
}

// 写作类路由：可信管理 IP + step-up（admin_step_up 的 ADMIN_ROLES 已含 author），
// 但 ADMIN_ROLES 是本文件的兜底复校 —— 防御 admin_step_up 未来放宽角色集合。
function requireAdminSecure(c) {
  requireTrustedAdminIp(c);
  var secure = stepUp.requireAdminStepUp(c, { requireVerifiedEmail: true });
  var role = '';
  try {
    role = String(secure && secure.actor && secure.actor.get('role') || '').trim();
  } catch (_) {
    role = '';
  }
  if (ADMIN_ROLES.indexOf(role) === -1) apiError(403, 'ADMIN_STEP_UP_REQUIRED');
  return secure;
}

// ---------- AI 配置诊断（字段级错误定位） ----------

// 集合尚未创建/读取失败时的兜底视图，形状与 ai_config.readPublic() 一致。
function emptySettingsView() {
  return {
    configured: false,
    enabled: false,
    base_url: '',
    model: '',
    timeout_seconds: 60,
    article_publish_mode: 'draft',
    comment_mode: 'off',
    banned_words_enabled: false,
    banned_words: [],
    reply_name: 'AI 助手',
    reply_persona: '',
    has_key: false,
    updated_at: '',
  };
}

function settingsView() {
  try { return aiConfig.readPublic($app.dao()); } catch (_) { return emptySettingsView(); }
}

// 诊断可接受的标量字段（表单与 query string 共用）。
// api_key 只允许走 JSON body，绝不进 URL —— 避免明文 key 落进访问日志。
var DIAGNOSTICS_SCALAR_FIELDS = [
  'base_url', 'model', 'timeout_seconds', 'article_publish_mode',
  'comment_mode', 'reply_name', 'reply_persona',
];

function toBool(value) {
  return value === true || value === 1 || value === 'true' || value === '1' ||
    value === 'yes' || value === 'on';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// GET 查询参数形态：?base_url=...&model=...&enabled=1&banned_words=a,b
function diagnosticsQueryInput(c) {
  var out = {};
  var any = false;
  var i;
  for (i = 0; i < DIAGNOSTICS_SCALAR_FIELDS.length; i++) {
    var name = DIAGNOSTICS_SCALAR_FIELDS[i];
    var value = '';
    try { value = String(c.queryParam(name) == null ? '' : c.queryParam(name)); } catch (_) { value = ''; }
    if (value !== '') { out[name] = value; any = true; }
  }
  try {
    if (String(c.queryParam('enabled') || '') !== '') { out.enabled = toBool(c.queryParam('enabled')); any = true; }
    if (String(c.queryParam('banned_words_enabled') || '') !== '') {
      out.banned_words_enabled = toBool(c.queryParam('banned_words_enabled'));
      any = true;
    }
    var words = String(c.queryParam('banned_words') || '');
    if (words) {
      var parts = words.split(',');
      var list = [];
      for (var w = 0; w < parts.length; w++) {
        var item = String(parts[w]).trim();
        if (item) list.push(item);
      }
      out.banned_words = list;
      any = true;
    }
  } catch (_) {}
  return any ? out : null;
}

// 输入优先级：JSON body（任何非空对象）> query string > 库内配置。
// 纯读：不写库、不解密 api_key。
function readDiagnosticsInput(c) {
  var body = null;
  try {
    var raw = readerToString(c.request().body, 8193) || '';
    if (raw.trim()) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        body = parsed;
      }
    }
  } catch (_) { body = null; }
  if (body) return body;
  return diagnosticsQueryInput(c);
}

// 把「当前表单输入」与库内脱敏配置合并成诊断用的完整表单：
// - 表单里出现的字段以表单为准，缺省字段回落到库内值；
// - api_key 只从 body 取（明文绝不回显），has_key 表示「本次新填了」或「库里/env 已有」。
function diagnosticsForm(input, stored) {
  var form = {};
  var provided = input && typeof input === 'object' ? input : {};
  for (var i = 0; i < DIAGNOSTICS_SCALAR_FIELDS.length; i++) {
    var key = DIAGNOSTICS_SCALAR_FIELDS[i];
    form[key] = hasOwn(provided, key) ? provided[key] : stored[key];
  }
  form.banned_words_enabled = hasOwn(provided, 'banned_words_enabled')
    ? toBool(provided.banned_words_enabled)
    : stored.banned_words_enabled === true;
  form.banned_words = hasOwn(provided, 'banned_words') ? provided.banned_words : stored.banned_words;
  form.enabled = hasOwn(provided, 'enabled') ? toBool(provided.enabled) : stored.enabled === true;
  form.api_key = hasOwn(provided, 'api_key') && provided.api_key != null ? String(provided.api_key) : '';
  form.has_key = form.api_key.length > 0 || stored.has_key === true;
  return form;
}

// 回显给前端的「生效视图」—— 绝不包含明文 api_key。
function effectiveView(form) {
  var baseUrlCheck = aiConfig.diagnoseBaseUrl(form.base_url);
  var rawBaseUrl = String(form.base_url == null ? '' : form.base_url).trim();
  return {
    base_url: baseUrlCheck.ok ? baseUrlCheck.value : rawBaseUrl,
    origin_allowed: baseUrlCheck.origin_allowed === true,
    model: String(form.model == null ? '' : form.model).trim(),
    has_key: form.has_key === true,
    enabled: form.enabled === true,
  };
}

function diagnosticsPayload(form) {
  var report = aiConfig.diagnostics(form);
  return { ok: report.ok, errors: report.errors, effective: effectiveView(form) };
}

// INVALID_AI_CONFIG 判定 / 字段提取。
// 注意（PB 0.22 实证）：ApiError 在请求 runtime 里被重新读出时，error.data 的值可能被
// PB 包装成 Go 对象（String() 得到 "[object Object]"），因此字段名以 message 前缀为准
// （invalid() 生成的 message 恒为 'INVALID_AI_CONFIG: <field> (...)'），error.data 仅作兜底。
function isInvalidAiConfig(error) {
  try {
    if (/^INVALID_AI_CONFIG\b/.test(String(error && error.message || ''))) return true;
  } catch (_) {}
  try {
    if (error && error.data && String(error.data.code || '') === 'INVALID_AI_CONFIG') return true;
  } catch (_) {}
  return false;
}

function invalidAiConfigField(error) {
  try {
    var match = /INVALID_AI_CONFIG:\s*([A-Za-z0-9_]+)/.exec(String(error && error.message || ''));
    if (match) return match[1];
  } catch (_) {}
  try {
    var field = error && error.data && error.data.field;
    if (typeof field === 'string' && field) return field;
  } catch (_) {}
  return 'config';
}

// 保存失败时的 400 响应：保留 PB 惯例的 { code, message }，把字段级诊断放进 data，
// 前端可据 data.field 精确定位输入项，data.errors 可一次展示全部问题。
// 同时把 field/reason/errors/effective 平铺到响应体顶层 —— 前端
// astro/src/lib/services/aiSettingsService.ts 的 aiConfigField() 是按
// `err.response.data.field ?? err.data.field`（即响应体本身）读取的，
// 两层都提供可同时兼容「读顶层」与「读 data」两种写法。
function respondInvalidAiConfig(c, error, input, stored) {
  var payload = diagnosticsPayload(diagnosticsForm(input, stored));
  var field = invalidAiConfigField(error);
  var errors = payload.errors && payload.errors.length ? payload.errors : [];
  if (!errors.length) {
    var message = String(error && error.message || '');
    var open = message.indexOf('(');
    var detail = open !== -1 ? message.slice(open + 1).replace(/\)\s*$/, '') : message;
    errors = [{ field: field, reason: detail || '配置值不合法' }];
  }
  var reason = '';
  for (var i = 0; i < errors.length; i++) {
    if (errors[i].field === field) { reason = String(errors[i].reason || ''); break; }
  }
  if (!reason) reason = String(errors[0].reason || '');
  var details = {
    code: 'INVALID_AI_CONFIG',
    field: field,
    reason: reason,
    ok: false,
    errors: errors,
    effective: payload.effective,
  };
  try { c.response().header().set('Cache-Control', 'no-store'); } catch (_) {}
  return c.json(400, {
    code: 400,
    message: String(error && error.message || 'INVALID_AI_CONFIG: ' + field),
    // 顶层平铺（前端 aiConfigField / readFieldReason 直接读响应体）
    field: field,
    reason: reason,
    ok: false,
    errors: errors,
    effective: payload.effective,
    // PB 惯例的 data 包装（任务契约 data:{ code:'INVALID_AI_CONFIG', field } 也满足）
    data: details,
  });
}

// ---------- GET /api/blog-admin/ai/settings ----------
function settingsRead(c) {
  requireSuperAdminSecure(c);
  return c.json(200, aiConfig.readPublic($app.dao()));
}

// ---------- GET /api/blog-admin/ai/diagnostics ----------
// 用当前表单输入（无输入则用库内配置）跑 aiConfig.diagnostics，返回
//   { ok, errors:[{field, reason}], effective:{ base_url, origin_allowed, model, has_key, enabled } }
// 纯读，不写库、不回显明文 key；鉴权与 /ai/settings 相同（可信 IP + super_admin + step-up）。
function diagnostics(c) {
  requireSuperAdminSecure(c);
  try { c.response().header().set('Cache-Control', 'no-store'); } catch (_) {}
  var stored = settingsView();
  var form = diagnosticsForm(readDiagnosticsInput(c), stored);
  return c.json(200, diagnosticsPayload(form));
}

// ---------- PUT /api/blog-admin/ai/settings ----------
function settingsSave(c) {
  var secure = requireSuperAdminSecure(c);
  var input = readBody(c, 8193);
  var stored = settingsView();
  var saved;
  try {
    saved = aiConfig.save($app.dao(), input, secure.actorId);
  } catch (error) {
    // 校验失败不再只回 'INVALID_AI_CONFIG: <field>' 字符串：把字段级原因一并带回（仍为 400）。
    if (isInvalidAiConfig(error)) return respondInvalidAiConfig(c, error, input, stored);
    throw error;
  }
  writeAudit(
    c,
    secure.actorId,
    'ai_settings_save',
    'ai_settings',
    '',
    'AI 设置保存: enabled=' + (saved.enabled ? 'true' : 'false') +
      ' comment_mode=' + String(saved.comment_mode || '') +
      ' article_publish_mode=' + String(saved.article_publish_mode || ''),
  );
  return c.json(200, saved);
}

// ---------- POST /api/blog-admin/ai/test ----------
function testConnection(c) {
  var secure = requireSuperAdminSecure(c);
  consumeQuota('ai_assist', secure.actorId);

  var cfg = aiConfig.resolve($app.dao());
  if (!cfg) return c.json(200, { ok: false, error: 'AI_NOT_CONFIGURED', message: '请先在 AI 设置中完成接入配置并启用' });

  var startedAt = Date.now();
  try {
    var result = aiClient.chat({
      system: 'You are a connectivity probe. Reply with exactly: pong',
      user: 'ping',
      maxTokens: 8,
      temperature: 0,
      config: cfg,
    });
    return c.json(200, {
      ok: true,
      latency_ms: Date.now() - startedAt,
      model: cfg.model,
      reply: String(result && result.content || '').trim().slice(0, 50),
    });
  } catch (e) {
    // AI_* ApiError 不抛出：探测端点用 200 + ok:false 回传，前端直接展示原因。
    var message = String(e && e.message || 'AI_UPSTREAM_ERROR');
    var code = message.indexOf(':') === -1 ? message : message.slice(0, message.indexOf(':'));
    if (code.indexOf('AI_') !== 0) code = 'AI_UPSTREAM_ERROR';
    return c.json(200, {
      ok: false,
      error: code,
      message: '连接失败（' + code + '）',
    });
  }
}

// ---------- 标签只关联已存在的标签 ----------
// tags 集合实际字段（pb_migrations/001_init_blog_collections.pb.js:92-106）：
//   name(text, required, max 80)、slug(text, required, 唯一索引)、description(text)
// post_tags 字段（同文件 108-118）：post_id(relation->posts)、tag_id(relation->tags)
// 找不到的标签直接跳过，绝不新建。
function attachExistingTags(dao, postId, tagNames) {
  if (!tagNames || typeof tagNames.length !== 'number' || !tagNames.length) return [];

  var wanted = [];
  for (var i = 0; i < tagNames.length && wanted.length < MAX_TAG_NAMES; i++) {
    var name = text(tagNames[i], 80);
    if (!name) continue;
    var dup = false;
    for (var d = 0; d < wanted.length; d++) {
      if (wanted[d].toLowerCase() === name.toLowerCase()) { dup = true; break; }
    }
    if (!dup) wanted.push(name);
  }
  if (!wanted.length) return [];

  // 全量读取 tags 做大小写不敏感精确匹配（走索引 + 兼容 PB 过滤器的大小写语义）
  var all = [];
  try {
    all = dao.findRecordsByFilter('tags', 'id != ""', 'name', 500, 0, {});
  } catch (_) {
    return [];
  }

  var postTagsCollection = null;
  try {
    postTagsCollection = dao.findCollectionByNameOrId('post_tags');
  } catch (_) {
    return [];
  }
  if (!postTagsCollection) return [];

  var attached = [];
  for (var w = 0; w < wanted.length; w++) {
    var match = null;
    for (var a = 0; a < all.length; a++) {
      if (String(all[a].getString('name') || '').toLowerCase() === wanted[w].toLowerCase()) {
        match = all[a];
        break;
      }
    }
    if (!match) continue;
    try {
      var link = new Record(postTagsCollection);
      link.set('post_id', postId);
      link.set('tag_id', match.id);
      dao.saveRecord(link);
      attached.push(match.getString('name'));
    } catch (_) {
      // 唯一索引 (post_id, tag_id) 冲突等 —— 跳过，不影响文章落库
    }
  }
  return attached;
}

// slug 生成：与前端 astro/src/hooks/domains/useAdminPosts.ts:106-121 算法一致
function buildSlug(rawHint) {
  var slug = String(rawHint == null ? '' : rawHint).trim();
  slug = slug.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
  if (!SLUG_PATTERN.test(slug)) {
    slug = slug.replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
  }
  if (!slug || !SLUG_PATTERN.test(slug)) slug = 'post-' + Date.now();
  return slug;
}

function uniqueSlug(dao, baseSlug) {
  var slug = baseSlug;
  try {
    var existing = dao.findFirstRecordByFilter('posts', 'slug = {:slug}', { slug: slug });
    if (existing) slug = baseSlug + '-' + Date.now().toString(36);
  } catch (_) {
    // 查询失败（无命中抛错也算）时保留原 slug，由 posts.slug 唯一索引兜底
  }
  return slug;
}

var ARTICLE_SYSTEM_PROMPT = [
  '你是一名中文技术博客作者助手。严格输出一个 JSON 对象，不要用 ``` 围栏包裹整个 JSON，也不要输出任何解释文字。',
  'JSON 结构：{"title":"≤60字","slug_hint":"小写英文连字符","excerpt":"≤120字","content":"Markdown 正文","seo_description":"≤150字","tag_names":["≤5个"]}',
  'content 必须是 Markdown 正文（本站前台按 Markdown 渲染，支持代码高亮、表格、公式与图表）。只有外层 JSON 不要围栏，content 内部的 Markdown 语法要原样保留。',
  '除 content 外，title/excerpt/seo_description/tag_names 一律纯文本，不要带 Markdown 标记或 HTML 标签；',
  'content 写作要求：',
  '- 标题层级：页面已渲染文章标题，正文不要重复 h1，从 ## 开始，按需使用 ###；',
  '- 代码：用 ``` 加语言围栏（如 ```python、```bash、```json、```ts），代码放在围栏内，不要转义成 HTML 实体；',
  '- 表格：用标准 Markdown 管道表格（含表头分隔行）；',
  '- 公式：行内用 $...$，独立公式用 $$...$$（LaTeX 语法）；',
  '- 图表：流程图/时序图用 ```mermaid 围栏；',
  '- 图片：用 ![说明](URL)；链接用 [文字](URL)；不要用 <img>/<a> 等 HTML 标签。',
  '安全：不要输出 <script>、内联事件属性（onclick 等）、<iframe>，也不要输出 html/head/body 标签。',
  '整个响应必须是合法 JSON：content 等字符串内的换行按 JSON 语法写成 \\n 转义（不要出现裸换行），双引号写成 \\"；不要在 JSON 外层加围栏。',
  '语言与主题保持一致；tag_names 只给已有技术标签候选名，不要自造长句。',
].join('\n');

function buildArticleUserPrompt(topic, outline, style, length) {
  var preset = LENGTH_PRESETS[length] || LENGTH_PRESETS.medium;
  var lines = [
    '主题：' + topic,
    '目标字数：约 ' + preset.words + ' 字',
  ];
  if (outline) lines.push('大纲（按要求组织正文）：\n' + outline);
  if (style) lines.push('风格要求：' + style);
  lines.push('请输出 JSON：content 用 Markdown 正文（可用 ``` 代码围栏、Markdown 表格、$...$ 与 $$...$$ 公式、```mermaid 图表和 ![说明](URL) 图片）；整个响应不要加围栏。');
  return lines.join('\n');
}

// ---------- POST /api/blog-admin/ai/article ----------
function generateArticle(c) {
  var secure = requireAdminSecure(c);
  var input = readBody(c, 65537);
  consumeQuota('ai_article', secure.actorId);

  var topic = text(input.topic, MAX_TOPIC_LEN);
  if (!topic) apiError(400, 'INVALID_REQUEST');
  var outline = text(input.outline, MAX_OUTLINE_LEN);
  var style = text(input.style, MAX_STYLE_LEN);
  var length = String(input.length || 'medium').trim();
  if (!LENGTH_PRESETS[length]) length = 'medium';
  var preset = LENGTH_PRESETS[length];

  var cfg = aiConfig.resolve($app.dao());
  if (!cfg) apiError(400, 'AI_NOT_CONFIGURED');

  var generated = aiClient.chatJson({
    system: ARTICLE_SYSTEM_PROMPT,
    user: buildArticleUserPrompt(topic, outline, style, length),
    maxTokens: preset.maxTokens,
    temperature: 0.7,
    config: cfg,
  });
  var data = generated && generated.data;
  if (!data || typeof data !== 'object') apiError(502, 'AI_BAD_RESPONSE');

  var title = text(data.title, 160);
  if (!title) apiError(502, 'AI_BAD_RESPONSE');
  var content = String(data.content == null ? '' : data.content);
  if (!content.trim()) apiError(502, 'AI_BAD_RESPONSE');
  var excerpt = text(data.excerpt, 500);
  var seoDescription = text(data.seo_description, 320);
  var tagNames = data.tag_names;
  if (!tagNames || typeof tagNames.length !== 'number') tagNames = [];

  var status = cfg.articlePublishMode === 'published' ? 'published' : 'draft';
  var dao = $app.dao();
  var slug = uniqueSlug(dao, buildSlug(data.slug_hint || title));
  var postId = '';

  dao.runInTransaction(function (txDao) {
    var post = new Record(txDao.findCollectionByNameOrId('posts'));
    post.set('title', title);
    post.set('slug', slug);
    post.set('content', content);
    post.set('excerpt', excerpt);
    post.set('cover', '');
    post.set('status', status);
    post.set('author', secure.actorId);
    post.set('published_at', status === 'published' ? new Date().toISOString() : '');
    post.set('views', 0);
    post.set('likes', 0);
    post.set('is_pinned', false);
    post.set('is_featured', false);
    post.set('seo_title', '');
    post.set('seo_description', seoDescription);
    post.set('seo_keywords', '');
    post.set('is_ai', true);
    txDao.saveRecord(post);
    postId = post.id;
    attachExistingTags(txDao, postId, tagNames);
  });

  writeAudit(c, secure.actorId, 'ai_article_create', 'posts', postId, 'AI 生成文章: ' + title);

  return c.json(200, { id: postId, slug: slug, status: status, title: title, excerpt: excerpt });
}

// ---------- 写作助手 ----------
var META_SYSTEM_PROMPT = [
  '你是一名中文技术博客编辑。严格输出一个 JSON 对象，不要 Markdown 围栏、不要解释文字。',
  'JSON 结构：{"titles":["3个候选标题"],"excerpt":"≤120字","tag_names":["≤5"],"seo_description":"≤150字"}',
  '不要输出结果之外的任何内容。',
].join('\n');

var POLISH_SYSTEM_PROMPT = [
  '你是一名中文博文润色助手。',
  '只输出润色后的 Markdown 正文，不要解释、不要前后缀、不要复述要求。',
  '不要用 ``` 围栏包裹整段输出；正文内部的 Markdown 语法（标题、列表、表格、链接、图片、公式）保持有效。',
  '代码块必须原样保留：``` 语言围栏、围栏内的代码与缩进一个字都不要改，不要重新格式化或"优化"代码。',
  '行内代码、$...$ 与 $$...$$ 公式、```mermaid 图表同样原样保留。',
  '不要输出 HTML 标签；图片用 ![说明](URL)。',
  '不要改变原意，不要新增事实。',
].join('\n');

var CONTINUE_SYSTEM_PROMPT = [
  '你是一名中文博文续写助手。',
  '只输出续写的 Markdown 正文本体，不要解释、不要前后缀、不要复述要求，也不要用 ``` 围栏包裹整段输出。',
  '与上文保持同一语言、语气与 Markdown 结构（标题层级、列表、表格、代码围栏风格一致），输出 200-400 字。',
  '续写位置若在代码块内部，只补全代码正文，不要重新开围栏；否则需要展示代码时用 ``` 加语言围栏。',
  '不要输出 <script>、内联事件属性或 <iframe>；不要输出 html/head/body 标签。',
].join('\n');

function assist(c) {
  var secure = requireAdminSecure(c);
  var input = readBody(c, 65537);
  consumeQuota('ai_assist', secure.actorId);

  var action = String(input.action || '').trim();
  var cfg = aiConfig.resolve($app.dao());
  if (!cfg) apiError(400, 'AI_NOT_CONFIGURED');

  if (action === 'meta') {
    var metaTitle = text(input.title, MAX_ASSIST_TITLE_LEN);
    var metaContent = text(input.content, MAX_ASSIST_CONTENT_LEN).slice(0, 8000);
    if (!metaTitle && !metaContent) apiError(400, 'INVALID_REQUEST');
    var meta = aiClient.chatJson({
      system: META_SYSTEM_PROMPT,
      user: '标题：' + metaTitle + '\n\n正文：\n' + metaContent + '\n\n请输出 JSON。',
      maxTokens: 1200,
      temperature: 0.6,
      config: cfg,
    });
    return c.json(200, meta && meta.data ? meta.data : {});
  }

  if (action === 'polish') {
    var selection = text(input.selection, MAX_ASSIST_SELECTION_LEN);
    if (!selection) apiError(400, 'INVALID_REQUEST');
    var polished = aiClient.chat({
      system: POLISH_SYSTEM_PROMPT,
      user: selection,
      maxTokens: 2000,
      temperature: 0.3,
      config: cfg,
    });
    return c.json(200, { text: String(polished && polished.content || '').trim() });
  }

  if (action === 'continue') {
    var body = text(input.content, MAX_ASSIST_CONTENT_LEN);
    var cursor = text(input.selection, MAX_ASSIST_SELECTION_LEN);
    var tail = body.slice(-3000);
    if (!tail && !cursor) apiError(400, 'INVALID_REQUEST');
    var continued = aiClient.chat({
      system: CONTINUE_SYSTEM_PROMPT,
      user: '上文：\n' + tail + (cursor ? '\n\n光标处上下文：\n' + cursor : '') + '\n\n请续写 200-400 字 Markdown 正文。',
      maxTokens: 2000,
      temperature: 0.7,
      config: cfg,
    });
    return c.json(200, { text: String(continued && continued.content || '').trim() });
  }

  apiError(400, 'INVALID_REQUEST');
}

// ---------- 评论单条手动触发（评论审核页行内按钮；复用 worker 单条逻辑） ----------
// 与 cron 批量的差异：管理员显式点击视为明确意图 —— 重审允许清除旧结论重跑，
// 回复绕过 72h backlog 守卫；其余跳过条件（已有 AI 子回复/父链 AI/深度）仍生效。
function loadCommentOr404(id) {
  var comment = null;
  try { comment = $app.dao().findRecordById('comments', id); } catch (_) {}
  if (!comment) apiError(404, 'COMMENT_NOT_FOUND');
  return comment;
}

function requireAiConfigured() {
  var cfg = aiConfig.resolve($app.dao());
  if (!cfg) apiError(400, 'AI_NOT_CONFIGURED');
  return cfg;
}

// POST /api/blog-admin/ai/comments/moderate —— 对 pending 评论立即执行 AI 审核
function moderateComment(c) {
  var secure = requireAdminSecure(c);
  var input = readBody(c, 8193);
  consumeQuota('ai_assist', secure.actorId);

  var id = text(input.commentId || input.comment_id, 64);
  if (!id) apiError(400, 'INVALID_REQUEST');
  var cfg = requireAiConfigured();
  var comment = loadCommentOr404(id);

  if (comment.getString('status') !== 'pending') apiError(400, 'INVALID_STATE: 仅待审核评论可执行 AI 审核');
  // 显式重审：清除旧标记让 worker 重跑（按钮只在已有结论时显示为"重审"）
  comment.set('ai_moderated', false);

  var stats = { moderated: 0, replied: 0, errors: 0 };
  var verdict = commentWorker.moderateOne(cfg, comment, stats);
  return c.json(200, {
    verdict: verdict,
    reason: comment.getString('ai_reason'),
    status: comment.getString('status'),
  });
}

// POST /api/blog-admin/ai/comments/reply —— 对 approved 评论立即生成 AI 回复
function replyComment(c) {
  var secure = requireAdminSecure(c);
  var input = readBody(c, 8193);
  consumeQuota('ai_assist', secure.actorId);

  var id = text(input.commentId || input.comment_id, 64);
  if (!id) apiError(400, 'INVALID_REQUEST');
  var cfg = requireAiConfigured();
  var comment = loadCommentOr404(id);

  if (comment.getString('status') !== 'approved') apiError(400, 'INVALID_STATE: 仅已通过评论可生成 AI 回复');
  if (comment.getBool('is_ai')) apiError(400, 'INVALID_STATE: AI 评论无需 AI 回复');
  // 显式重试（例如曾被 cron 按 backlog 跳过）：重置标记；cutoff=-1 绕过时间守卫
  comment.set('ai_replied', false);

  var stats = { moderated: 0, replied: 0, errors: 0 };
  var outcome = commentWorker.processOneReply($app.dao(), cfg, comment, stats, -1) || {};
  return c.json(200, {
    outcome: outcome.outcome || 'unknown',
    reason: outcome.reason || '',
    replyId: outcome.replyId || '',
    status: outcome.status || '',
  });
}

// ---------- 留言 AI 审核（POST /api/blog-admin/ai/guestbook/moderate） ----------
// 与评论审核复用同一份 prompt / 调用参数（ai_moderation.classify），差异只在落库语义：
// guestbook_messages 的状态枚举是 show / hidden（评论是 pending/approved/spam）。
function loadGuestbookOr404(id) {
  var message = null;
  try { message = $app.dao().findRecordById(GUESTBOOK_COLLECTION, id); } catch (_) {}
  if (!message) apiError(404, 'MESSAGE_NOT_FOUND');
  return message;
}

// 迁移 20261124120000_add_guestbook_ai_fields 未应用时 ai_* 字段不存在：
// 用 schema 探测决定是否回写，避免把不存在的列写进记录。
function guestbookSupportsAiFields(dao) {
  var collection = null;
  try { collection = dao.findCollectionByNameOrId(GUESTBOOK_COLLECTION); } catch (_) { collection = null; }
  if (!collection) return false;
  for (var i = 0; i < GUESTBOOK_AI_FIELDS.length; i++) {
    var found = false;
    try { found = !!collection.schema.getFieldByName(GUESTBOOK_AI_FIELDS[i]); } catch (_) { found = false; }
    if (!found) return false;
  }
  return true;
}

// verdict → status：
//   spam    → hidden（集合 listRule/viewRule 只放行 status = "show"）
//   approve → show
//   unsure / error → 保持原状态（新建留言经 validate_guestbook 恒为 show），只记录结论交人工复核
function applyGuestbookVerdict(dao, message, outcome) {
  var persisted = guestbookSupportsAiFields(dao);
  if (persisted) {
    try {
      message.set('ai_verdict', String(outcome.verdict || ''));
      message.set('ai_reason', String(outcome.reason || '').slice(0, GUESTBOOK_REASON_MAX));
      message.set('ai_moderated', true);
    } catch (error) {
      persisted = false;
      console.warn('[ai-admin] guestbook ai_* write skipped: ' +
        String((error && error.message) || error).slice(0, 120));
    }
  } else {
    console.warn('[ai-admin] guestbook ai_* fields missing; apply pb_migrations/20261124120000_add_guestbook_ai_fields');
  }

  var status = '';
  try { status = String(message.getString('status') || ''); } catch (_) { status = ''; }
  if (outcome.verdict === 'spam') {
    message.set('status', GUESTBOOK_STATUS_HIDDEN);
    status = GUESTBOOK_STATUS_HIDDEN;
  } else if (outcome.verdict === 'approve') {
    message.set('status', GUESTBOOK_STATUS_VISIBLE);
    status = GUESTBOOK_STATUS_VISIBLE;
  }
  dao.saveRecord(message);
  return { status: status, persisted: persisted };
}

// 单条留言立即 AI 审核。鉴权同评论审核：requireAdminSecure（author/admin/super_admin + step-up）。
function moderateGuestbook(c) {
  var secure = requireAdminSecure(c);
  var input = readBody(c, 8193);
  consumeQuota('ai_assist', secure.actorId);

  var id = text(input.message_id || input.messageId || input.id, 64);
  if (!id) apiError(400, 'INVALID_REQUEST');
  var cfg = requireAiConfigured();
  var message = loadGuestbookOr404(id);

  var nickname = '';
  try { nickname = String(message.getString('nickname') || ''); } catch (_) { nickname = ''; }
  var content = '';
  try { content = String(message.getString('content') || ''); } catch (_) { content = ''; }

  // 留言没有文章标题，用「留言板」定位场景；昵称与正文同属不可信用户输入，一并送审。
  var outcome = aiModeration.classify(cfg, '留言板', '留言者：' + nickname + '\n' + content);
  var applied = applyGuestbookVerdict($app.dao(), message, outcome);

  writeAudit(
    c,
    secure.actorId,
    'ai_guestbook_moderate',
    GUESTBOOK_COLLECTION,
    id,
    '留言 AI 审核: verdict=' + outcome.verdict + ' status=' + applied.status +
      (applied.persisted ? '' : ' (ai_* 字段缺失未写入)'),
  );

  // AI 调用失败同样以 200 + verdict='error' 回传（与评论审核口径一致），前端可展示原因。
  return c.json(200, {
    verdict: outcome.verdict,
    reason: String(outcome.reason || '').slice(0, GUESTBOOK_REASON_MAX),
    status: applied.status,
  });
}

module.exports = {
  settingsRead: settingsRead,
  settingsSave: settingsSave,
  diagnostics: diagnostics,
  testConnection: testConnection,
  generateArticle: generateArticle,
  assist: assist,
  moderateComment: moderateComment,
  replyComment: replyComment,
  moderateGuestbook: moderateGuestbook,
};
