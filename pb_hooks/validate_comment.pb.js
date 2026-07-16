(function () {
const MAX_NESTING_DEPTH = 5;

onRecordBeforeCreateRequest((e) => {
  const stripTags = (value) => String(value || '').replace(/<[^>]*>/g, '').trim();
  const commentRateBuckets = globalThis.commentRateBuckets || (globalThis.commentRateBuckets = {});

  // Cleanup old entries periodically
  const _now = Date.now();
  if (!globalThis._commentLastCleanup || _now - globalThis._commentLastCleanup > 5 * 60 * 1000) {
    globalThis._commentLastCleanup = _now;
    for (const key of Object.keys(commentRateBuckets)) {
      const bucket = commentRateBuckets[key];
      if (!bucket || bucket.length === 0 || _now - bucket[bucket.length - 1] > 600000) {
        delete commentRateBuckets[key];
      }
    }
  }

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

  const getClientIP = () => {
    try {
      const real = e.httpContext?.realIP?.();
      if (real && real.trim()) return real.trim();
    } catch (_) {}
    return '';
  };

  const rateLimit = (key, limit, windowMs) => {
    if (!key) return;
    const now = Date.now();
    const bucketKey = String(key);
    const bucket = commentRateBuckets[bucketKey] || [];
    const active = bucket.filter((time) => now - time < windowMs);
    if (active.length >= limit) {
      throw new BadRequestError('Too many comment submissions. Please retry later.');
    }
    active.push(now);
    commentRateBuckets[bucketKey] = active;
  };

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
  const ip = getClientIP();
  if (!ip) throw new BadRequestError('无法识别客户端');

  if (!boolSetting('enable_comments', true)) throw new BadRequestError('Comments are disabled.');
  if (!authorName) throw new BadRequestError('Author name is required.');
  if (!authorEmail) throw new BadRequestError('Author email is required.');
  if (!content) throw new BadRequestError('Comment content is required.');
  if (!postId) throw new BadRequestError('Post does not exist.');
  if (authorName.length > 50) throw new BadRequestError('Author name is too long.');
  if (authorEmail.length > 100) throw new BadRequestError('Author email is too long.');
  if (content.length > 2000) throw new BadRequestError('Comment content is too long.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) throw new BadRequestError('Invalid email format.');
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
  try {
    ownerUser = $app.dao().findFirstRecordByFilter('users', 'email = {:email}', { email: authorEmail.toLowerCase() });
  } catch (_) {
    // No matching user — legitimate anonymous comment, fall through.
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

  rateLimit('ip:min:' + ip, 5, 60 * 1000);
  rateLimit('ip:hour:' + ip, 30, 60 * 60 * 1000);
  rateLimit('email:min:' + authorEmail.toLowerCase(), 3, 60 * 1000);
  rateLimit('post:min:' + postId, 12, 60 * 1000);

  record.set('author_name', authorName);
  record.set('author_email', authorEmail);
  record.set('content', content);
  // Impersonation attempts are never auto-published, even when moderation is
  // disabled — they must pass admin review. Legitimate comments respect the
  // moderation setting as before.
  const baseStatus = boolSetting('comment_moderation', true) ? 'pending' : 'approved';
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
