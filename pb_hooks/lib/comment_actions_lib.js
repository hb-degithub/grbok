'use strict';

// 评论点赞、编辑、删除业务逻辑
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）

// 注意：lib 模块作用域内 __hooks 不存在（模块顶层与函数体内 require 绝对
// 路径都会抛 Invalid module），一律用相对路径 require。
var rateLimit = require('./security_rate_limit.js');
var verification = require('./comment_verification.js');

function detailedError(status, code, retryAfter) {
  var data = {
    code: new ValidationError(code, code),
  };
  if (retryAfter) {
    data.retryAfter = new ValidationError('COMMENT_ACTION_RETRY_AFTER', String(retryAfter));
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
// 兜底从原始 URL 路径解析 /api/comments/<id>/<action>。
function pathParam(e, name) {
  try {
    var v = e.pathParam(name);
    if (v) return String(v);
  } catch (_) {}
  try {
    var u = e.request().url;
    var p = String((u && u.path) || '');
    var parts = p.split('/');
    if (name === 'id' && parts.length >= 5 && parts[1] === 'api' && parts[2] === 'comments' && parts[3]) {
      return decodeURIComponent(parts[3]);
    }
  } catch (_) {}
  return '';
}

// 读取 JSON 请求体。e.requestInfo() 在 PB 0.22.21 JSVM 路由事件上不存在，
// 与 stats_lib.js readBody 同款：readerToString + JSON.parse，失败回退 {}。
function readBody(e) {
  try {
    var raw = readerToString(e.request().body, 4097);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (_) {
    return {};
  }
}

function findComment(id) {
  try {
    return $app.dao().findRecordById('comments', id);
  } catch (_) {
    return null;
  }
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
    throw detailedError(503, 'COMMENT_ACTION_UNAVAILABLE');
  }
  if (!decision.allowed) {
    throw detailedError(429, 'COMMENT_ACTION_RATE_LIMITED', decision.retryAfterSeconds);
  }
}

/**
 * 点赞评论
 */
function likeComment(e) {
  var commentId = pathParam(e, 'id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'comment_like_ip');

  // 用服务端 HMAC 生成稳定访客指纹，防止同一访客重复点赞；
  // 原始 IP/User-Agent 不落库，commentId 纳入指纹避免跨评论关联。
  var userAgent = '';
  try { userAgent = String(e.request().header.get('User-Agent') || ''); } catch (_) {}
  var visitorHash;
  try {
    visitorHash = require('./mail_crypto.js').hashPrivate(
      'comment-like',
      ip + '|' + userAgent + '|' + commentId,
    );
  } catch (_) {
    throw detailedError(503, 'COMMENT_ACTION_UNAVAILABLE');
  }

  var result;
  var alreadyLiked = false;
  $app.dao().runInTransaction(function (txDao) {
    var comment = txDao.findRecordById('comments', commentId);
    if (!comment) throw new NotFoundError('Comment not found');
    if (comment.get('status') !== 'approved') throw new BadRequestError('Only approved comments can be liked');
    if (comment.get('deleted')) throw new BadRequestError('Comment has been deleted');

    var currentLikes = comment.getInt('likes') || 0;
    var existing = null;
    try {
      existing = txDao.findFirstRecordByFilter(
        'comment_likes',
        'comment = {:comment} && visitor_hash = {:hash}',
        { comment: commentId, hash: visitorHash },
      );
    } catch (_) {}

    if (existing) {
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    var likeRecord = new Record(txDao.findCollectionByNameOrId('comment_likes'));
    likeRecord.set('comment', commentId);
    likeRecord.set('visitor_hash', visitorHash);
    try {
      txDao.saveRecord(likeRecord);
    } catch (_) {
      // 唯一索引处理并发重复请求：第二个事务仅在确有记录时按已点赞返回；
      // 其他数据库错误 fail closed，避免静默丢失真实故障。
      var racedLike = null;
      try {
        racedLike = txDao.findFirstRecordByFilter(
          'comment_likes',
          'comment = {:comment} && visitor_hash = {:hash}',
          { comment: commentId, hash: visitorHash },
        );
      } catch (_) {}
      if (!racedLike) throw detailedError(503, 'COMMENT_ACTION_UNAVAILABLE');
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    comment.set('likes', currentLikes + 1);
    txDao.saveRecord(comment);
    result = currentLikes + 1;
  });

  var response = { ok: true, likes: result };
  if (alreadyLiked) response.alreadyLiked = true;
  return e.json(200, response);
}

/**
 * 编辑评论（需要邮箱验证码验证身份）
 */
function editComment(e) {
  var commentId = pathParam(e, 'id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var body = readBody(e);
  var newContent = String(body.content || '').trim();
  var authorEmail = String(body.author_email || '').trim().toLowerCase();
  var verificationCode = String(body.verification_code || '').trim();

  if (!newContent) throw new BadRequestError('Content is required');
  if (!authorEmail) throw new BadRequestError('Email is required');
  if (!verificationCode) throw new BadRequestError('Verification code is required');
  if (newContent.length > 2000) throw new BadRequestError('Content is too long');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'comment_edit_ip');

  var comment = findComment(commentId);
  if (!comment) throw new NotFoundError('Comment not found');
  if (comment.get('deleted')) throw new BadRequestError('Comment has been deleted');

  // 验证邮箱匹配
  var commentEmail = String(comment.get('author_email') || '').toLowerCase();
  if (commentEmail !== authorEmail) {
    throw new ForbiddenError('Email does not match comment author');
  }

  // 验证邮箱验证码
  if (!verification.verifyCode(authorEmail, verificationCode)) {
    throw new ForbiddenError('Invalid or expired verification code');
  }

  // 过滤内容（循环剥离至稳定，防止 <scr<script>ipt> 绕过）
  var cleanContent = newContent;
  var prev;
  do {
    prev = cleanContent;
    cleanContent = cleanContent.replace(/<[^>]*>/g, '');
  } while (cleanContent !== prev);
  cleanContent = cleanContent.trim();
  if (!cleanContent) throw new BadRequestError('Content is required');

  comment.set('content', cleanContent);
  comment.set('edited', true);
  comment.set('edited_at', new Date().toISOString());
  $app.dao().saveRecord(comment);

  return e.json(200, { ok: true });
}

/**
 * 删除评论（软删除，需要邮箱验证码验证身份）
 */
function deleteComment(e) {
  var commentId = pathParam(e, 'id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var body = readBody(e);
  var authorEmail = String(body.author_email || '').trim().toLowerCase();
  var verificationCode = String(body.verification_code || '').trim();

  if (!authorEmail) throw new BadRequestError('Email is required');
  if (!verificationCode) throw new BadRequestError('Verification code is required');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'comment_delete_ip');

  var comment = findComment(commentId);
  if (!comment) throw new NotFoundError('Comment not found');
  if (comment.get('deleted')) throw new BadRequestError('Comment already deleted');

  // 验证邮箱匹配
  var commentEmail = String(comment.get('author_email') || '').toLowerCase();
  if (commentEmail !== authorEmail) {
    throw new ForbiddenError('Email does not match comment author');
  }

  // 验证邮箱验证码
  if (!verification.verifyCode(authorEmail, verificationCode)) {
    throw new ForbiddenError('Invalid or expired verification code');
  }

  // 软删除
  comment.set('deleted', true);
  $app.dao().saveRecord(comment);

  return e.json(200, { ok: true });
}

/**
 * 发送验证码
 */
function sendVerification(e) {
  var body = readBody(e);
  var email = String(body.email || '').trim().toLowerCase();

  if (!email) throw new BadRequestError('Email is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError('Invalid email format');

  var ip = getClientIP(e);
  var result = verification.sendVerificationCode(email, ip);

  return e.json(200, result);
}

module.exports = {
  likeComment: likeComment,
  editComment: editComment,
  deleteComment: deleteComment,
  sendVerification: sendVerification,
};
