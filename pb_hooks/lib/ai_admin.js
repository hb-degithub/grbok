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
// 前台正文用 set:html 渲染（无 Markdown 渲染器），因此 article 的 content 必须是
// HTML 片段，且标签集在系统提示里被严格白名单约束（见 ARTICLE_SYSTEM_PROMPT）。

var aiConfig = require('./ai_config.js');
var aiClient = require('./ai_client.js');
var stepUp = require('./admin_step_up.js');
var rateLimit = require('./security_rate_limit.js');
var commentWorker = require('./ai_comment_worker.js');

var ADMIN_ROLES = ['author', 'admin', 'super_admin'];

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

// ---------- GET /api/blog-admin/ai/settings ----------
function settingsRead(c) {
  requireSuperAdminSecure(c);
  return c.json(200, aiConfig.readPublic($app.dao()));
}

// ---------- PUT /api/blog-admin/ai/settings ----------
function settingsSave(c) {
  var secure = requireSuperAdminSecure(c);
  var input = readBody(c, 8193);
  var saved = aiConfig.save($app.dao(), input, secure.actorId);
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
  '你是一名中文技术博客作者助手。严格输出一个 JSON 对象，不要 Markdown 围栏、不要任何解释文字。',
  'JSON 结构：{"title":"≤60字","slug_hint":"小写英文连字符","excerpt":"≤120字","content":"HTML 正文","seo_description":"≤150字","tag_names":["≤5个"]}',
  'content 必须是可直接嵌入页面的 HTML 片段（本站前台用 set:html 渲染，没有 Markdown 渲染器）：',
  '只允许这些标签：h2、h3、p、ul、ol、li、pre、code、strong、em、blockquote、a、img；',
  '用 h2 分节；代码必须放在 <pre><code> 里；不要出现 html/head/body 标签（会破坏页面结构）；',
  '不要在 content 里重复 h1 标题；content 里不要写 Markdown 语法（如 ##、**、```）。',
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
  lines.push('请输出 JSON。');
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
  '只输出润色后的结果本体，不要解释、不要前后缀、不要复述要求、不要加代码围栏。',
  '保持输入的格式：输入是 HTML 就输出 HTML 片段，输入是纯文本就输出纯文本。',
  '不要改变原意，不要新增事实，不要输出 Markdown。',
].join('\n');

var CONTINUE_SYSTEM_PROMPT = [
  '你是一名中文博文续写助手。',
  '只输出续写的正文本体，不要解释、不要前后缀、不要复述要求、不要加代码围栏。',
  '与上文保持同一语言、语气与格式（上文是 HTML 就续写 HTML 片段），输出 200-400 字。',
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
      user: '上文：\n' + tail + (cursor ? '\n\n光标处上下文：\n' + cursor : '') + '\n\n请续写 200-400 字。',
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

module.exports = {
  settingsRead: settingsRead,
  settingsSave: settingsSave,
  testConnection: testConnection,
  generateArticle: generateArticle,
  assist: assist,
  moderateComment: moderateComment,
  replyComment: replyComment,
};
