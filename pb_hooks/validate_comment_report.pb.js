(function () {
/// <reference path="../pb_data/types.d.ts" />

// Comment report rate limiting — per-IP, persisted via security_rate_limit so
// limits survive restarts and stay consistent across instances.
onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  if (!record) return;

  const rateLimit = require(__hooks + '/lib/security_rate_limit.js');

  // Detailed error shape mirroring validate_guestbook.pb.js so the frontend
  // can surface a server-provided message.
  const detailedError = (status, code, retryAfter) => {
    const data = {
      code: new ValidationError(code, code),
    };
    if (retryAfter) {
      data.retryAfter = new ValidationError('COMMENT_REPORT_RETRY_AFTER', String(retryAfter));
    }
    return new ApiError(status, code, data);
  };

  // Resolve real client IP through the shared client_ip helper (ESA
  // ali-real-client-ip header with realIP() fallback). Preserve the original
  // 'unknown' fallback subject when no IP can be resolved so reporters
  // behind a misconfigured proxy still share a single bucket instead of being
  // blocked outright.
  let ip;
  try {
    const raw = require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext);
    ip = rateLimit.normalizeIp(raw);
  } catch (_) {
    ip = 'unknown';
  }

  let decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: [{ policyKey: 'comment_report_ip', subject: ip }],
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    // RateLimitUnavailableError — fail closed with 503.
    throw detailedError(503, 'COMMENT_REPORT_UNAVAILABLE');
  }

  if (!decision.allowed) {
    throw detailedError(429, 'COMMENT_REPORT_RATE_LIMITED', decision.retryAfterSeconds);
  }

  // 服务端写入真实客户端 IP（客户端不应也不能提供自己的 IP）
  record.set('reporter_ip', String(ip || 'unknown').slice(0, 45));

  // 验证举报理由非空
  if (!String(record.get('reason') || '').trim()) {
    throw new BadRequestError('请填写举报理由');
  }

  if (typeof e.next === 'function') e.next();
}, 'comment_reports');

// 举报创建后通知管理员
onRecordAfterCreateRequest((e) => {
  var record = e.record;
  if (!record) return;

  try {
    var commentId = record.getString('comment_id');
    var reason = record.getString('reason');
    var reporterIp = record.getString('reporter_ip');

    // 查找评论内容
    var comment = $app.dao().findRecordById('comments', commentId);
    var commentContent = comment ? comment.getString('content') : '(已删除)';
    var commentAuthor = comment ? comment.getString('author_name') : '未知';
    var postId = comment ? comment.getString('post_id') : '';

    // 查找文章标题
    var postTitle = '(未知文章)';
    var postUrl = '';
    if (postId) {
      try {
        var post = $app.dao().findRecordById('posts', postId);
        postTitle = post.getString('title');
        var base = String($os.getenv('PUBLIC_SITE_URL') || $app.settings().meta.appUrl || 'https://hlydwz.com').replace(/\/$/, '');
        postUrl = base + '/posts/' + encodeURIComponent(post.getString('slug') || post.id);
      } catch (_) {}
    }

    // 查找所有管理员邮箱
    var admins = $app.dao().findRecordsByFilter('users', 'role = "admin" || role = "super_admin"', '', 10, 0);
    var adminEmails = [];
    for (var i = 0; i < admins.length; i++) {
      var email = String(admins[i].getString('email') || '').trim().toLowerCase();
      if (email) adminEmails.push(email);
    }

    if (adminEmails.length === 0) return;

    // 发送通知邮件给所有管理员
    $app.dao().runInTransaction(function (txDao) {
      for (var i = 0; i < adminEmails.length; i++) {
        require(__hooks + '/lib/mail_outbox.js').enqueue(txDao, {
          dedupeKey: 'comment_report:' + record.id + ':admin:' + adminEmails[i],
          category: 'comment_report_notification',
          recipient: adminEmails[i],
          templateKey: 'comment_report',
          variables: {
            commentAuthor: commentAuthor,
            commentContent: commentContent,
            reportReason: reason,
            reporterIp: reporterIp,
            postTitle: postTitle,
            postUrl: postUrl,
          },
        });
      }
    });
  } catch (_) {
    console.error('[comment-report] operation=notify result=INTERNAL_ERROR');
  }

  if (typeof e.next === 'function') e.next();
}, 'comment_reports');
})();
