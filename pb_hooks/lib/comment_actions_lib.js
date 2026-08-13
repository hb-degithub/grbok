'use strict';

// 评论点赞、编辑、删除业务逻辑
// 所有函数自包含，不依赖闭包变量（PB 0.22 JSVM 限制）

var rateLimit = require(__hooks + '/lib/security_rate_limit.js');
var verification = require(__hooks + '/lib/comment_verification.js');

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
    return rateLimit.normalizeIp(require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext));
  } catch (_) {
    return 'unknown';
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
  var commentId = e.request.pathParam('id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var ip = getClientIP(e);
  checkRateLimit(ip, 'comment_like_ip');

  // 使用事务防止并发丢更新
  var result;
  $app.dao().runInTransaction(function (txDao) {
    var comment = txDao.findRecordById('comments', commentId);
    if (!comment) throw new NotFoundError('Comment not found');
    if (comment.get('status') !== 'approved') throw new BadRequestError('Only approved comments can be liked');
    if (comment.get('deleted')) throw new BadRequestError('Comment has been deleted');

    var currentLikes = comment.getInt('likes') || 0;
    comment.set('likes', currentLikes + 1);
    txDao.saveRecord(comment);
    result = currentLikes + 1;
  });

  return e.json(200, { ok: true, likes: result });
}

/**
 * 编辑评论（需要邮箱验证码验证身份）
 */
function editComment(e) {
  var commentId = e.request.pathParam('id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var body = e.requestInfo().body;
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
  var commentId = e.request.pathParam('id');
  if (!commentId) throw new BadRequestError('Comment ID is required');

  var body = e.requestInfo().body;
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
  var body = e.requestInfo().body;
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
