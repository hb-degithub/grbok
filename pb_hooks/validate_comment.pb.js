(function () {
const MAX_NESTING_DEPTH = 5;

onRecordBeforeCreateRequest((e) => {
  const stripTags = (value) => String(value || '').replace(/<[^>]*>/g, '').trim();

  const rateLimit = require(__hooks + '/lib/security_rate_limit.js');

  // Detailed error shape mirroring validate_guestbook.pb.js so the frontend
  // can surface server-provided Chinese copy instead of a hardcoded fallback.
  // retryAfter is attached when the request is rate-limited (HTTP 429).
  const detailedError = (status, code, retryAfter) => {
    const data = {
      code: new ValidationError(code, code),
    };
    if (retryAfter) {
      data.retryAfter = new ValidationError('COMMENT_RETRY_AFTER', String(retryAfter));
    }
    return new ApiError(status, code, data);
  };

  const boolSetting = (key, fallback) => {
    try {
      let record = null;
      if ($app.findFirstRecordByFilter) {
        record = $app.findFirstRecordByFilter('settings', 'key = {:key}', { key: key });
      } else {
        record = $app.dao().findFirstRecordByFilter('settings', 'key = {:key}', { key: key });
      }
      const value = record.get('value');
      return value === true || value === 'true';
    } catch (_) {
      return fallback;
    }
  };

  const findRecord = (collection, id) => {
    if (!id) return null;
    if ($app.findRecordById) return $app.findRecordById(collection, id);
    return $app.dao().findRecordById(collection, id);
  };

  // Real client IP via the shared client_ip helper: prefers the ESA-injected
  // ali-real-client-ip header and falls back to realIP(). Returns '' when no
  // IP can be resolved.
  var ip;
  try {
    ip = rateLimit.normalizeIp(
      require(__hooks + '/lib/client_ip.js').clientIp(e.httpContext),
    );
  } catch (_) {
    // normalizeIp throws on empty/invalid input — keep the original "无法识别
    // 客户端" semantics so anonymous clients behind a misconfigured proxy
    // still get a clear, distinguishable rejection.
    throw new BadRequestError('无法识别客户端');
  }

  const hasSpamPattern = (content) => {
    const linkCount = (content.match(/https?:\/\//gi) || []).length;
    if (linkCount > 2) return true;
    if (/(.)\1{24,}/.test(content)) return true;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) return true;
    return false;
  };

  const record = e.record;
  const postId = String(record.get('post_id') || '').trim();
  const parentId = String(record.get('parent_id') || '').trim();
  const authorName = stripTags(record.get('author_name'));
  const authorEmail = String(record.get('author_email') || '').trim();
  const content = stripTags(record.get('content'));

  if (!boolSetting('enable_comments', true)) throw new BadRequestError('Comments are disabled.');
  if (!authorName) throw new BadRequestError('Author name is required.');
  if (!content) throw new BadRequestError('Comment content is required.');
  if (!postId) throw new BadRequestError('Post does not exist.');
  if (authorName.length > 50) throw new BadRequestError('Author name is too long.');
  if (content.length > 2000) throw new BadRequestError('Comment content is too long.');
  // 邮箱可选：仅在提供时校验格式
  if (authorEmail) {
    if (authorEmail.length > 100) throw new BadRequestError('Author email is too long.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) throw new BadRequestError('Invalid email format.');
  }
  if (hasSpamPattern(content)) throw new BadRequestError('Comment contains suspicious content.');

  // H4/H5: anti-impersonation + side-channel elimination.
  // If author_email belongs to a registered user, the requester MUST be
  // authenticated as that exact user. An anonymous (or different) requester
  // using a registered user's email is an impersonation attempt — we must NOT
  // let it be published as that user. To avoid revealing that the email is
  // registered (which would let an attacker enumerate accounts), we do NOT
  // throw a distinguishable error: we silently accept the comment into the
  // pending moderation queue, with a response identical to the unregistered
  // anonymous path. The admin reviews it; it is never auto-published.
  let ownerUser = null;
  let authenticatedOwner = null;
  record.set('author_user', '');
  if (authorEmail) {
    try {
      ownerUser = $app.dao().findFirstRecordByFilter('users', 'email = {:email}', { email: authorEmail.toLowerCase() });
    } catch (_) {
      // No matching user — legitimate anonymous comment, fall through.
    }
  }

  let impersonationAttempt = false;
  if (ownerUser) {
    let authed = null;
    if (e.auth) {
      authed = e.auth;
    } else {
      try {
        if (typeof $apis !== 'undefined' && e.httpContext) {
          const info = $apis.requestInfo(e.httpContext);
          authed = info.auth || info.authRecord || null;
        }
      } catch (_) {}
    }

    if (!authed || authed.id !== ownerUser.id) {
      // Anonymous or wrong-user comment using a registered email. Silently
      // force into pending; response stays identical to the anonymous path.
      impersonationAttempt = true;
    } else if (!ownerUser.verified()) {
      // Authenticated owner but email not verified — keep the verification
      // gate. No side-channel: the requester is the account owner and
      // already knows the email is registered.
      throw new BadRequestError('请先验证你的邮箱后再发表评论');
    } else {
      authenticatedOwner = authed;
    }
  }

  if (authenticatedOwner) {
    record.set('author_user', ownerUser.id);
  }

  const post = findRecord('posts', postId);
  if (!post || post.get('status') !== 'published') {
    throw new BadRequestError('Only published posts can be commented on.');
  }

  if (parentId) {
    const parent = findRecord('comments', parentId);
    if (!parent || parent.get('post_id') !== postId || parent.get('status') !== 'approved') {
      throw new BadRequestError('Replies must target an approved comment on the same post.');
    }

    let depth = 1;
    let ancestorId = parent.get('parent_id');
    while (ancestorId) {
      depth++;
      if (depth > MAX_NESTING_DEPTH) break;
      const ancestor = findRecord('comments', ancestorId);
      ancestorId = ancestor ? ancestor.get('parent_id') : null;
    }
    if (depth > MAX_NESTING_DEPTH) {
      throw new BadRequestError('评论嵌套深度不能超过5层');
    }
  }

  // Three-axis rate limiting (IP / email / post) using the persistent,
  // multi-instance-safe limiter. Thresholds align with the prior in-memory
  // buckets' per-minute axes (the per-hour IP axis was strictly weaker than
  // the per-minute axis and is subsumed by it). All three entries are
  // consumed atomically inside a single transaction so a partial write can
  // never leak a quota decrement.
  // 邮箱可选：未提供时跳过 email 维度限流
  let normalizedEmail = null;
  if (authorEmail) {
    try {
      normalizedEmail = rateLimit.normalizeEmail(authorEmail);
    } catch (_) {
      // Email shape was already validated above; treat normalization failure
      // as a transient store error rather than a leak.
      throw detailedError(503, 'COMMENT_UNAVAILABLE');
    }
  }

  const limitEntries = [
    { policyKey: 'comment_ip', subject: ip },
    { policyKey: 'comment_post', subject: postId },
  ];
  if (normalizedEmail) {
    limitEntries.push({ policyKey: 'comment_email', subject: normalizedEmail });
  }

  let decision;
  try {
    $app.dao().runInTransaction(function (txDao) {
      decision = rateLimit.consume(txDao, {
        nowMs: Date.now(),
        entries: limitEntries,
      });
    });
    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid rate decision');
  } catch (_) {
    // RateLimitUnavailableError (degraded store / corrupt bucket / write
    // failure) — fail closed with 503 so the operator is alerted without
    // silently dropping the request.
    throw detailedError(503, 'COMMENT_UNAVAILABLE');
  }

  if (!decision.allowed) {
    throw detailedError(429, 'COMMENT_RATE_LIMITED', decision.retryAfterSeconds);
  }

  record.set('author_name', authorName);
  record.set('author_email', authorEmail);
  record.set('content', content);
  
  // 等级权限：Lv3+ 用户评论免审核
  var authorLevel = 1;
  if (authenticatedOwner) {
    try {
      var authorUser = $app.dao().findRecordById('users', authenticatedOwner.id);
      authorLevel = authorUser.getInt('level') || 1;
    } catch (_) {}
  }
  
  // Impersonation attempts are never auto-published, even when moderation is
  // disabled — they must pass admin review. Legitimate comments respect the
  // moderation setting as before.
  // Lv3+ 用户评论免审核（除非 moderation 强制开启）
  const baseStatus = boolSetting('comment_moderation', true) && authorLevel < 3 ? 'pending' : 'approved';
  record.set('status', impersonationAttempt ? 'pending' : baseStatus);
  record.set('ip_address', ip || '');

  if (typeof e.next === 'function') e.next();
}, 'comments');

onRecordBeforeUpdateRequest((e) => {
  if (!e.record || !e.record.id) return;
  const persisted = $app.dao().findRecordById('comments', e.record.id);
  const originalAuthorUser = String(persisted.get('author_user') || '');
  e.record.set('author_user', originalAuthorUser);
  if (typeof e.next === 'function') e.next();
}, 'comments');
})();
