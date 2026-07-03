onRecordBeforeCreateRequest((e) => {
  const stripTags = (value) => String(value || '').replace(/<[^>]*>/g, '').trim();
  const commentRateBuckets = globalThis.commentRateBuckets || (globalThis.commentRateBuckets = {});

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

  const getHeader = (name) => {
    try {
      return e.httpContext?.request()?.header?.get(name) || '';
    } catch (_) {
      return '';
    }
  };

  const getClientIP = () => {
    const forwarded = getHeader('X-Forwarded-For');
    if (forwarded) return forwarded.split(',')[0].trim();
    const real = getHeader('X-Real-IP');
    if (real) return real.trim();
    try {
      return e.httpContext?.realIP?.() || '';
    } catch (_) {
      return '';
    }
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

  const post = findRecord('posts', postId);
  if (!post || post.get('status') !== 'published') {
    throw new BadRequestError('Only published posts can be commented on.');
  }

  if (parentId) {
    const parent = findRecord('comments', parentId);
    if (!parent || parent.get('post_id') !== postId || parent.get('status') !== 'approved') {
      throw new BadRequestError('Replies must target an approved comment on the same post.');
    }
  }

  rateLimit('ip:min:' + ip, 5, 60 * 1000);
  rateLimit('ip:hour:' + ip, 30, 60 * 60 * 1000);
  rateLimit('email:min:' + authorEmail.toLowerCase(), 3, 60 * 1000);
  rateLimit('post:min:' + postId, 12, 60 * 1000);

  record.set('author_name', authorName);
  record.set('author_email', authorEmail);
  record.set('content', content);
  record.set('status', boolSetting('comment_moderation', true) ? 'pending' : 'approved');
  record.set('ip_address', ip || '');

  if (typeof e.next === 'function') e.next();
}, 'comments');
