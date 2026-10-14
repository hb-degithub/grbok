'use strict';

// 文章点赞、收藏业务逻辑（2026-10-14 安全加固版）
//
// 安全模型变更（渗透测试 #3）：
//   1. 必须已认证用户才能点赞/收藏（匿名 401）；
//   2. 去重键与计数一律绑定**用户 id**，不再使用「ESA 边缘 IP + User-Agent」；
//      IP / User-Agent / X-Browser-Fingerprint 仅作限流与留痕的辅助信号；
//   3. 补齐 DELETE /api/posts/:id/like（取消点赞，计数 -1 且不为负）
//      与 DELETE /api/posts/:id/bookmark（取消收藏）；
//   4. 持久化限流（用户维度优先，策略键缺失时回退 IP 维度）。
//
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）。

var rateLimit = require('./security_rate_limit.js');
var actionAuth = require('./action_auth_lib.js');

// 错误码保持向后兼容（前端与既有巡检脚本依赖 code 字段）。
function detailedError(status, code, retryAfter) {
  var data = {
    code: new ValidationError(code, code),
  };
  if (retryAfter) {
    data.retryAfter = new ValidationError('POST_ACTION_RETRY_AFTER', String(retryAfter));
  }
  return new ApiError(status, code, data);
}

function pathParam(e, name) {
  try {
    var v = e.pathParam(name);
    if (v) return String(v);
  } catch (_) {}
  try {
    var u = e.request().url;
    var p = String((u && u.path) || '');
    var parts = p.split('/');
    if (name === 'id' && parts.length >= 5 && parts[1] === 'api' && parts[2] === 'posts' && parts[3]) {
      return decodeURIComponent(parts[3]);
    }
  } catch (_) {}
  return '';
}

// 用户绑定的去重键：HMAC(scope, userId|postId)。userId 绑定是本修复的核心——
// 用户身份不可伪造（JWT/session 由 PB 鉴权中间件校验），而边缘 IP / UA 可伪造。
function userBoundHash(scope, userId, postId) {
  try {
    return require('./mail_crypto.js').hashPrivate(scope, userId + '|' + postId);
  } catch (_) {
    throw actionAuth.actionUnavailable();
  }
}

function findLike(txDao, postId, visitorHash, userId) {
  try {
    return txDao.findFirstRecordByFilter(
      'post_likes',
      'post = {:post} && visitor_hash = {:hash}',
      { post: postId, hash: visitorHash },
    );
  } catch (_) {}
  // 兼容历史记录：加固前落库的行没有 user 字段，按 user 关系再查一次，
  // 避免老用户被判定为「未点赞」而重复 +1。
  try {
    return txDao.findFirstRecordByFilter(
      'post_likes',
      'post = {:post} && user = {:user}',
      { post: postId, user: userId },
    );
  } catch (_) {}
  return null;
}

function findBookmark(txDao, postId, visitorHash, userId) {
  try {
    return txDao.findFirstRecordByFilter(
      'post_bookmarks',
      'post = {:post} && visitor_hash = {:hash}',
      { post: postId, hash: visitorHash },
    );
  } catch (_) {}
  try {
    return txDao.findFirstRecordByFilter(
      'post_bookmarks',
      'post = {:post} && user = {:user}',
      { post: postId, user: userId },
    );
  } catch (_) {}
  return null;
}

function countBookmarks(txDao, postId) {
  var total = 0;
  var page = 0;
  // 分批统计，避免单次 findRecordsByFilter 上限截断导致计数偏小。
  while (true) {
    var rows;
    try {
      rows = txDao.findRecordsByFilter(
        'post_bookmarks',
        'post = {:post}',
        'created',
        500,
        page * 500,
        { post: postId },
      );
    } catch (_) {
      throw actionAuth.actionUnavailable();
    }
    total += rows.length;
    if (rows.length < 500) break;
    page++;
  }
  return total;
}

// 统一的「鉴权 → 辅助信号 → 限流」前置流程。
function beginAction(e, policyKey) {
  var user = actionAuth.requireUser(e);
  var ip = actionAuth.clientIp(e);
  var fingerprint = actionAuth.clientFingerprint(e);
  var policy = actionAuth.USER_POLICY_KEYS[policyKey];

  var decision = actionAuth.checkRateLimit({
    userPolicyKey: policyKey,
    userSubject: String(user.id),
    fallbackPolicyKey: policy.fallbackKey,
    scope: policy.scope,
    ip: ip,
  });
  if (!decision.allowed) {
    throw actionAuth.actionRateLimited(
      policy.scope.toUpperCase() + '_RATE_LIMITED',
      decision.retryAfterSeconds,
    );
  }

  // 浏览器指纹（辅助信号）：同一账号短时间出现多个不同指纹时追加一次
  // 更紧的 IP 维度限流；不命中则不产生任何额外限制。
  var anomalyKey = actionAuth.fingerprintAnomalyKey(String(user.id), policyKey);
  var anomalyLimited = false;
  if (anomalyKey) {
    var extra;
    try {
      extra = actionAuth.checkRateLimit({
        userPolicyKey: '',
        userSubject: '',
        fallbackPolicyKey: anomalyKey,
        scope: policy.scope + '_fingerprint',
        ip: ip,
      });
    } catch (_) {
      extra = { allowed: true };
    }
    if (extra && extra.allowed === false) {
      actionAuth.auditAction('action_fingerprint_anomaly_blocked', {
        actor: String(user.id),
        targetCollection: 'users',
        targetId: String(user.id),
        summary: 'policy=' + policyKey + ' fingerprintPresent=' + String(fingerprint.present),
      });
      throw actionAuth.actionRateLimited(
        policy.scope.toUpperCase() + '_FINGERPRINT_RATE_LIMITED',
        Number(extra.retryAfterSeconds) || 1,
      );
    }
    anomalyLimited = true;
  }
  actionAuth.noteFingerprint(String(user.id), fingerprint.value);

  return {
    user: user,
    userId: String(user.id),
    ip: ip,
    fingerprintPresent: Boolean(fingerprint.present),
    fingerprintSource: fingerprint.present ? 'header' : 'absent',
    limitSource: decision.degraded ? 'ip-fallback' : 'user',
    anomaly: anomalyLimited,
  };
}

function auditSafely(action, ctx, postId, summary) {
  actionAuth.auditAction(action, {
    actor: ctx.userId,
    targetCollection: 'posts',
    targetId: String(postId),
    summary: String(summary || '').slice(0, 500),
  });
}

/**
 * 点赞文章（幂等：重复点赞不重复计数）
 */
function likePost(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ctx = beginAction(e, 'post_like_user', postId);
  var visitorHash = userBoundHash('post-like', ctx.userId, postId);

  var result;
  var alreadyLiked = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');
    if (post.get('status') !== 'published') throw new BadRequestError('Only published posts can be liked');

    var currentLikes = post.getInt('likes') || 0;
    var existing = findLike(txDao, postId, visitorHash, ctx.userId);
    if (existing) {
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    var likeRecord = new Record(txDao.findCollectionByNameOrId('post_likes'));
    likeRecord.set('post', postId);
    likeRecord.set('visitor_hash', visitorHash);
    try {
      likeRecord.set('user', ctx.userId);
    } catch (_) {}
    try {
      txDao.saveRecord(likeRecord);
    } catch (_) {
      // 唯一索引处理并发重复请求：第二个事务仅在确有记录时按已点赞返回；
      // 其他数据库错误 fail closed，避免静默丢失真实故障。
      var racedLike = findLike(txDao, postId, visitorHash, ctx.userId);
      if (!racedLike) throw actionAuth.actionUnavailable();
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    post.set('likes', currentLikes + 1);
    txDao.saveRecord(post);
    result = currentLikes + 1;
  });

  auditSafely(alreadyLiked ? 'post_like_duplicate' : 'post_like', ctx, postId,
    'likes=' + String(result) + ' source=' + ctx.limitSource);

  var response = {
    ok: true,
    likes: result,
    fingerprintSeen: ctx.fingerprintPresent,
    fingerprintSource: ctx.fingerprintSource,
    limitSource: ctx.limitSource,
  };
  if (alreadyLiked) response.alreadyLiked = true;
  if (ctx.anomaly) response.anomaly = true;
  return e.json(200, response);
}

/**
 * 取消点赞（计数 -1，且绝不为负）
 */
function unlikePost(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ctx = beginAction(e, 'post_like_user', postId);
  var visitorHash = userBoundHash('post-like', ctx.userId, postId);

  var result;
  var removed = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');

    var currentLikes = post.getInt('likes') || 0;
    var existing = findLike(txDao, postId, visitorHash, ctx.userId);
    if (existing) {
      txDao.deleteRecord(existing);
      removed = true;
      var next = currentLikes - 1;
      if (next < 0) next = 0;
      if (next !== currentLikes) {
        post.set('likes', next);
        txDao.saveRecord(post);
      }
      result = next;
      return;
    }
    // 未点赞：幂等返回当前计数，不做减法（绝不减成负数）。
    result = currentLikes;
  });

  auditSafely(removed ? 'post_unlike' : 'post_unlike_noop', ctx, postId,
    'likes=' + String(result) + ' source=' + ctx.limitSource);

  var response = {
    ok: true,
    likes: result,
    removed: removed,
    fingerprintSeen: ctx.fingerprintPresent,
    fingerprintSource: ctx.fingerprintSource,
    limitSource: ctx.limitSource,
  };
  if (ctx.anomaly) response.anomaly = true;
  return e.json(200, response);
}

/**
 * 收藏文章（幂等：重复收藏不重复计数）
 */
function bookmarkPost(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ctx = beginAction(e, 'post_bookmark_user', postId);
  var visitorHash = userBoundHash('post-bookmark', ctx.userId, postId);

  var result;
  var alreadyBookmarked = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');
    if (post.get('status') !== 'published') throw new BadRequestError('Only published posts can be bookmarked');

    var existing = findBookmark(txDao, postId, visitorHash, ctx.userId);
    if (existing) {
      alreadyBookmarked = true;
      result = countBookmarks(txDao, postId);
      return;
    }

    var bookmarkRecord = new Record(txDao.findCollectionByNameOrId('post_bookmarks'));
    bookmarkRecord.set('post', postId);
    bookmarkRecord.set('visitor_hash', visitorHash);
    try {
      bookmarkRecord.set('user', ctx.userId);
    } catch (_) {}
    try {
      txDao.saveRecord(bookmarkRecord);
    } catch (_) {
      var racedBookmark = findBookmark(txDao, postId, visitorHash, ctx.userId);
      if (!racedBookmark) throw actionAuth.actionUnavailable();
      alreadyBookmarked = true;
      result = countBookmarks(txDao, postId);
      return;
    }
    result = countBookmarks(txDao, postId);
  });

  auditSafely(alreadyBookmarked ? 'post_bookmark_duplicate' : 'post_bookmark', ctx, postId,
    'count=' + String(result) + ' source=' + ctx.limitSource);

  var response = {
    ok: true,
    bookmarked: true,
    count: result,
    fingerprintSeen: ctx.fingerprintPresent,
    fingerprintSource: ctx.fingerprintSource,
    limitSource: ctx.limitSource,
  };
  if (alreadyBookmarked) response.alreadyBookmarked = true;
  if (ctx.anomaly) response.anomaly = true;
  return e.json(200, response);
}

/**
 * 取消收藏文章（幂等）
 */
function unbookmarkPost(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ctx = beginAction(e, 'post_bookmark_user', postId);
  var visitorHash = userBoundHash('post-bookmark', ctx.userId, postId);

  var result;
  var removed = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');

    var existing = findBookmark(txDao, postId, visitorHash, ctx.userId);
    if (existing) {
      txDao.deleteRecord(existing);
      removed = true;
    }
    result = countBookmarks(txDao, postId);
  });

  auditSafely(removed ? 'post_unbookmark' : 'post_unbookmark_noop', ctx, postId,
    'count=' + String(result) + ' source=' + ctx.limitSource);

  var response = {
    ok: true,
    bookmarked: false,
    removed: removed,
    count: result,
    fingerprintSeen: ctx.fingerprintPresent,
    fingerprintSource: ctx.fingerprintSource,
    limitSource: ctx.limitSource,
  };
  if (ctx.anomaly) response.anomaly = true;
  return e.json(200, response);
}

module.exports = {
  likePost: likePost,
  unlikePost: unlikePost,
  bookmarkPost: bookmarkPost,
  unbookmarkPost: unbookmarkPost,
  // 保留旧名，避免外部引用（若有）失效；语义已从 toggle 收敛为「收藏」。
  toggleBookmark: bookmarkPost,
};
