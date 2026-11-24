'use strict';

// 公开互动聚合：GET /api/post-engagement?limit=50
//
// 背景（2026-11）：`reactions` 集合的 API 规则已全部置为 null
// （pb_migrations/20261115202000_harden_reactions_rules.pb.js），匿名/读者直连
// /api/collections/reactions/records 恒 403「Only admins」，数据洞察看板因此拿不到
// 互动数据（前端只能把 reactions 计数降级成 0）。本接口把统计口径收回服务端：
// 一次聚合同时算出浏览 / 反应 / 评论，不依赖任何集合读规则，也不暴露
// fingerprint、user_id、ip 等敏感列。
//
// 口径（与前端 insightsService 的 SCORE 权重一致）：
//   views     = posts.views
//   reactions = reactions 表中 post_id = 该文章的行数（评论维度的反应行没有 post_id，不计入）
//   comments  = comments 表中 post_id = 该文章 && status = "approved" && deleted = false
//   score     = views + reactions*3 + comments*5
// 只统计 status = "published" 的文章，按 score 降序（同分再按 views 降序、标题升序保证稳定）。
//
// 实现说明：聚合走 $app.dao().db()（DAO 的 DB builder，与 lib/stats_lib.js 的
// queryRows 同款写法），在 SQLite 内完成计数与排序 —— 避免 N+1 查询，
// 也避免逐个集合走 API 规则（reactions 对匿名永久 403）。
// 模板参数只用于 limit，其余过滤条件是常量，无用户可控 SQL 拼接。

var DEFAULT_LIMIT = 20;
var MAX_LIMIT = 100;
var CACHE_CONTROL = 'public, max-age=30';
var LIST_SHAPE = { id: '', title: '', slug: '', views: 0, reactions: 0, comments: 0, score: 0 };

var AGGREGATE_SQL = [
  'SELECT id, title, slug, views, reactions, comments,',
  '       (views + reactions * 3 + comments * 5) AS score',
  'FROM (',
  '  SELECT p.id AS id,',
  '         p.title AS title,',
  '         p.slug AS slug,',
  '         COALESCE(p.views, 0) AS views,',
  '         (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) AS reactions,',
  '         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id',
  "            AND c.status = 'approved' AND COALESCE(c.deleted, 0) = 0) AS comments",
  '  FROM posts p',
  "  WHERE p.status = 'published'",
  ')',
  'ORDER BY score DESC, views DESC, title ASC',
  'LIMIT {:limit}',
].join(' ');

function toCount(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// limit：缺省/非法 → 默认 20；<1 → 默认；>100 → 100（上限硬约束）。
function parseLimit(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_LIMIT;
  var n = Number(String(raw).trim());
  if (!isFinite(n)) return DEFAULT_LIMIT;
  n = Math.floor(n);
  if (n < 1) return DEFAULT_LIMIT;
  return n > MAX_LIMIT ? MAX_LIMIT : n;
}

function queryRows(params) {
  var rows = arrayOf(new DynamicModel(LIST_SHAPE));
  $app.dao().db().newQuery(AGGREGATE_SQL).bind(params || {}).all(rows);
  return rows;
}

function list(c) {
  var limit = DEFAULT_LIMIT;
  try { limit = parseLimit(c.queryParam('limit')); } catch (_) { limit = DEFAULT_LIMIT; }

  var rows;
  try {
    rows = queryRows({ limit: limit });
  } catch (error) {
    // 聚合失败（表结构缺失等）：不向上抛 500 堆栈，返回稳定错误码供前端降级。
    console.error('[post-engagement] aggregate failed: ' +
      String((error && error.message) || error).slice(0, 200));
    return c.json(503, { ok: false, error: 'ENGAGEMENT_UNAVAILABLE' });
  }

  var items = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var views = toCount(row.views);
    var reactions = toCount(row.reactions);
    var comments = toCount(row.comments);
    items.push({
      postId: String(row.id || ''),
      title: String(row.title == null ? '' : row.title),
      // slug 为附加字段（契约只要求 postId/title/计数），方便前端直接拼文章链接。
      slug: String(row.slug == null ? '' : row.slug),
      views: views,
      reactions: reactions,
      comments: comments,
      score: views + reactions * 3 + comments * 5,
    });
  }

  try {
    c.response().header().set('Cache-Control', CACHE_CONTROL);
  } catch (_) {}
  return c.json(200, { items: items, generatedAt: new Date().toISOString() });
}

module.exports = {
  list: list,
  parseLimit: parseLimit,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  MAX_LIMIT: MAX_LIMIT,
  CACHE_CONTROL: CACHE_CONTROL,
};
