'use strict';

// 评论点赞、编辑、删除业务逻辑（2026-10-14 安全加固版）
//
// 点赞部分的安全模型变更（渗透测试 #3）：
//   1. 必须已认证用户才能点赞（匿名 401）；
//   2. 去重键绑定**用户 id**，不再使用「ESA 边缘 IP + User-Agent」；
//   3. 补齐 DELETE /api/comments/:id/like（取消点赞，计数 -1 且不为负）；
//   4. 持久化限流（用户维度优先，策略键缺失时回退 IP 维度）。
// 编辑/删除评论仍走「邮箱验证码」身份通道，其 IP 限流保持不变。
//
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）。

var rateLimit = require('./security_rate_limit.js');
var verification = require('./comment_verification.js');
var actionAuth = require('./action_auth_lib.js');

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

// 编辑/删除/验证码仍按 IP 维度限流，保持既有行为不回归。
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

// 用户绑定的去重键：HMAC(scope, userId|commentId)。
function userBoundHash(scope, userId, commentId) {
  try {
    return require('./mail_crypto.js').hashPrivate(scope, userId + '|' + commentId);
  } catch (_) {
    throw actionAuth.actionUnavailable();
  }
}

function findCommentLike(txDao, commentId, visitorHash, userId) {
  try {
    return txDao.findFirstRecordByFilter(
      'comment_likes',
      'comment = {:comment} && visitor_hash = {:hash}',
      { comment: commentId, hash: visitorHash },
    );
  } catch (_) {}
  // 兼容历史记录（加固前的 IP 绑定行没有 user 字段）。
  try {
    return txDao.findFirstRecordByFilter(
      'comment_likes',
      'comment = {:comment} && user = {:user}',
      { comment: commentId, user: userId },
    );
  } catch (_) {}
  return null;
}

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
    userId: String(user.id),
    ip: ip,
    fingerprintPresent: Boolean(fingerprint.present),
    fingerprintSource: fingerprint.present ? 'header' : 'absent',
    limitSource: decision.degraded ? 'ip-fallback' : 'user',
    anomaly: anomalyLimited,
  };
}

function auditSafely(action, ctx, commentId, summary) {
  actionAuth.auditAction(action, {
    actor: ctx.userId,
    targetCollection: 'comments',
    targetId: String(commentId),
    summary: String(summary || '').slice(0, 500),
  });
}

/**
 * 点赞评论（幂等：重复点赞不重复计数）
 */
function likeComment(e) {
  var commentId = pathParam(e, 'id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var ctx = beginAction(e, 'comment_like_user');
  var visitorHash = userBoundHash('comment-like', ctx.userId, commentId);

  var result;
  var alreadyLiked = false;
  var authorUserId = '';
  $app.dao().runInTransaction(function (txDao) {
    var comment = txDao.findRecordById('comments', commentId);
    if (!comment) throw new NotFoundError('Comment not found');
    if (comment.get('status') !== 'approved') throw new BadRequestError('Only approved comments can be liked');
    if (comment.get('deleted')) throw new BadRequestError('Comment has been deleted');

    var currentLikes = comment.getInt('likes') || 0;
    var existing = findCommentLike(txDao, commentId, visitorHash, ctx.userId);
    if (existing) {
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    var likeRecord = new Record(txDao.findCollectionByNameOrId('comment_likes'));
    likeRecord.set('comment', commentId);
    likeRecord.set('visitor_hash', visitorHash);
    try {
      likeRecord.set('user', ctx.userId);
    } catch (_) {}
    try {
      txDao.saveRecord(likeRecord);
    } catch (_) {
      // 唯一索引处理并发重复请求：第二个事务仅在确有记录时按已点赞返回；
      // 其他数据库错误 fail closed，避免静默丢失真实故障。
      var racedLike = findCommentLike(txDao, commentId, visitorHash, ctx.userId);
      if (!racedLike) throw detailedError(503, 'COMMENT_ACTION_UNAVAILABLE');
      alreadyLiked = true;
      result = currentLikes;
      return;
    }

    comment.set('likes', currentLikes + 1);
    txDao.saveRecord(comment);
    result = currentLikes + 1;

    // 获赞统计与经验（仅注册用户作者）；统计失败不阻断点赞主流程
    authorUserId = String(comment.get('author_user') || '').trim();
    if (authorUserId) {
      try {
        require('./user_level_lib.js').addLikeReceived(txDao, authorUserId, 1);
      } catch (likeErr) {
        console.error('[user-level] operation=like-received result=INTERNAL_ERROR detail=' + String(likeErr && likeErr.message || likeErr).slice(0, 200));
      }
    }
  });

  auditSafely(alreadyLiked ? 'comment_like_duplicate' : 'comment_like', ctx, commentId,
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
 * 取消点赞评论（计数 -1，且绝不为负）
 */
function unlikeComment(e) {
  var commentId = pathParam(e, 'id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var ctx = beginAction(e, 'comment_like_user');
  var visitorHash = userBoundHash('comment-like', ctx.userId, commentId);

  var result;
  var removed = false;
  $app.dao().runInTransaction(function (txDao) {
    var comment = txDao.findRecordById('comments', commentId);
    if (!comment) throw new NotFoundError('Comment not found');

    var currentLikes = comment.getInt('likes') || 0;
    var existing = findCommentLike(txDao, commentId, visitorHash, ctx.userId);
    if (!existing) {
      result = currentLikes;
      return;
    }


    txDao.deleteRecord(existing);
    removed = true;
    var next = currentLikes - 1;
    if (next < 0) next = 0;
    if (next !== currentLikes) {
      comment.set('likes', next);
      txDao.saveRecord(comment);
    }
    result = next;

    // 作者获赞统计同步回退（尽力而为）
    var authorUserId = String(comment.get('author_user') || '').trim();
    if (authorUserId) {
      try {
        require('./user_level_lib.js').addLikeReceived(txDao, authorUserId, -1);
      } catch (likeErr) {
        console.error('[user-level] operation=like-received-rollback result=INTERNAL_ERROR detail=' + String(likeErr && likeErr.message || likeErr).slice(0, 200));
      }
    }
  });

  auditSafely(removed ? 'comment_unlike' : 'comment_unlike_noop', ctx, commentId,
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
  unlikeComment: unlikeComment,
  editComment: editComment,
  deleteComment: deleteComment,
  sendVerification: sendVerification,
};
