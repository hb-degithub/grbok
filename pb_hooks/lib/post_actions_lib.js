'use strict';

// 文章点赞、收藏业务逻辑
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）

// 注意：lib 模块作用域内 __hooks 不存在（模块顶层与函数体内 require 绝对
// 路径都会抛 Invalid module），一律用相对路径 require。
var rateLimit = require('./security_rate_limit.js');

function detailedError(status, code, retryAfter) {
  var data = {
    code: new ValidationError(code, code),
  };
  if (retryAfter) {
    data.retryAfter = new ValidationError('POST_ACTION_RETRY_AFTER', String(retryAfter));
  }
  return new ApiError(status, code, data);
}

function getClientIP(e) {
  try {
    return rateLimit.normalizeIp(require('./client_ip.js').clientIp(e));
  } catch (_) {
    return 'unknown';
  }
}

// 读取路由路径参数。PB 0.22.21 JSVM 的 routerAdd 事件 e 本身就是 echo Context
//（e.httpContext 不存在，e.request.pathParam 也不存在），正确入口是
// e.pathParam（见 pb_data/types.d.ts echo.Context.pathParam，已实测）；
// 兜底从原始 URL 路径解析 /api/posts/<id>/<action>。
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

function checkRateLimit(ip, policyKey) {
  var decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: policyKey, subject: ip }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
  }
  if (!decision.allowed) {
    throw detailedError(429, 'POST_ACTION_RATE_LIMITED', decision.retryAfterSeconds);
  }
}

/**
 * 点赞文章
 */
function likePost(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'post_like_ip');

  // 用服务端 HMAC 生成稳定访客指纹，防止同一访客重复点赞；
  // 原始 IP/User-Agent 不落库，postId 纳入指纹避免跨文章关联。
  var userAgent = '';
  try { userAgent = String(e.request().header.get('User-Agent') || ''); } catch (_) {}
  var visitorHash;
  try {
    visitorHash = require('./mail_crypto.js').hashPrivate(
      'post-like',
      ip + '|' + userAgent + '|' + postId,
    );
  } catch (_) {
    throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
  }

  var result;
  var alreadyLiked = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');
    if (post.get('status') !== 'published') throw new BadRequestError('Only published posts can be liked');

    var currentLikes = post.getInt('likes') || 0;
    var existing = null;
    try {
      existing = txDao.findFirstRecordByFilter(
        'post_likes',
        'post = {:post} && visitor_hash = {:hash}',
        { post: postId, hash: visitorHash },
      );
    } catch (_) {}

    if (existing) {
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    var likeRecord = new Record(txDao.findCollectionByNameOrId('post_likes'));
    likeRecord.set('post', postId);
    likeRecord.set('visitor_hash', visitorHash);
    try {
      txDao.saveRecord(likeRecord);
    } catch (_) {
      // 唯一索引处理并发重复请求：第二个事务仅在确有记录时按已点赞返回；
      // 其他数据库错误 fail closed，避免静默丢失真实故障。
      var racedLike = null;
      try {
        racedLike = txDao.findFirstRecordByFilter(
          'post_likes',
          'post = {:post} && visitor_hash = {:hash}',
          { post: postId, hash: visitorHash },
        );
      } catch (_) {}
      if (!racedLike) throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    post.set('likes', currentLikes + 1);
    txDao.saveRecord(post);
    result = currentLikes + 1;
  });

  var response = { ok: true, likes: result };
  if (alreadyLiked) response.alreadyLiked = true;
  return e.json(200, response);
}

/**
 * 收藏/取消收藏文章（toggle 语义）
 */
function toggleBookmark(e) {
  var postId = pathParam(e, 'id');
  if (!postId) throw new BadRequestError('Post ID is required');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'post_bookmark_ip');

  // 用服务端 HMAC 生成稳定访客指纹，防止同一访客重复操作；
  // 原始 IP/User-Agent 不落库，postId 纳入指纹避免跨文章关联。
  var userAgent = '';
  try { userAgent = String(e.request().header.get('User-Agent') || ''); } catch (_) {}
  var visitorHash;
  try {
    visitorHash = require('./mail_crypto.js').hashPrivate(
      'post-bookmark',
      ip + '|' + userAgent + '|' + postId,
    );
  } catch (_) {
    throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
  }

  var result;
  var bookmarked = false;
  $app.dao().runInTransaction(function (txDao) {
    var post = txDao.findRecordById('posts', postId);
    if (!post) throw new NotFoundError('Post not found');
    if (post.get('status') !== 'published') throw new BadRequestError('Only published posts can be bookmarked');

    var existing = null;
    try {
      existing = txDao.findFirstRecordByFilter(
        'post_bookmarks',
        'post = {:post} && visitor_hash = {:hash}',
        { post: postId, hash: visitorHash },
      );
    } catch (_) {}

    if (existing) {
      txDao.deleteRecord(existing);
      bookmarked = false;
    } else {
      var bookmarkRecord = new Record(txDao.findCollectionByNameOrId('post_bookmarks'));
      bookmarkRecord.set('post', postId);
      bookmarkRecord.set('visitor_hash', visitorHash);
      try {
        txDao.saveRecord(bookmarkRecord);
      } catch (_) {
        // 唯一索引处理并发重复请求：第二个事务仅在确有记录时按已收藏返回；
        // 其他数据库错误 fail closed，避免静默丢失真实故障。
        var racedBookmark = null;
        try {
          racedBookmark = txDao.findFirstRecordByFilter(
            'post_bookmarks',
            'post = {:post} && visitor_hash = {:hash}',
            { post: postId, hash: visitorHash },
          );
        } catch (_) {}
        if (!racedBookmark) throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
        bookmarked = true;
        result = countBookmarks(txDao, postId);
        return;
      }
      bookmarked = true;
    }

    result = countBookmarks(txDao, postId);
  });

  return e.json(200, { ok: true, bookmarked: bookmarked, count: result });
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
      throw detailedError(503, 'POST_ACTION_UNAVAILABLE');
    }
    total += rows.length;
    if (rows.length < 500) break;
    page++;
  }
  return total;
}

module.exports = {
  likePost: likePost,
  toggleBookmark: toggleBookmark,
};
