function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

const commentRateBuckets = {};

function boolSetting(key, fallback) {
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
}

function findRecord(collection, id) {
  if (!id) return null;
  if ($app.findRecordById) return $app.findRecordById(collection, id);
  return $app.dao().findRecordById(collection, id);
}

function rateLimit(key, limit, windowMs) {
  if (!key) return;

  const now = Date.now();
  const bucketKey = String(key);
  const bucket = commentRateBuckets[bucketKey] || [];
  const active = bucket.filter((time) => now - time < windowMs);

  if (active.length >= limit) {
    throw new BadRequestError('提交太频繁，请稍后再试');
  }

  active.push(now);
  commentRateBuckets[bucketKey] = active;
}

function hasSpamPattern(content) {
  const linkCount = (content.match(/https?:\/\//gi) || []).length;
  if (linkCount > 2) return true;
  if (/(.)\1{24,}/.test(content)) return true;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) return true;
  return false;
}

function getHeader(e, name) {
  try { return e.httpContext?.request()?.header?.get(name) || ''; } catch (_) { return ''; }
}

function getClientIP(e) {
  const forwarded = getHeader(e, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = getHeader(e, 'X-Real-IP');
  if (real) return real.trim();
  try { return e.httpContext?.realIP?.() || ''; } catch (_) { return ''; }
}

onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  const postId = String(record.get('post_id') || '').trim();
  const parentId = String(record.get('parent_id') || '').trim();
  const authorName = stripTags(record.get('author_name'));
  const authorEmail = String(record.get('author_email') || '').trim();
  const content = stripTags(record.get('content'));
  const ip = getClientIP(e);

  if (!boolSetting('enable_comments', true)) throw new BadRequestError('评论功能已关闭');

  if (!authorName) throw new BadRequestError('昵称不能为空');
  if (!authorEmail) throw new BadRequestError('邮箱不能为空');
  if (!content) throw new BadRequestError('评论内容不能为空');
  if (!postId) throw new BadRequestError('文章不存在');
  if (authorName.length > 50) throw new BadRequestError('昵称不能超过 50 个字符');
  if (authorEmail.length > 100) throw new BadRequestError('邮箱不能超过 100 个字符');
  if (content.length > 2000) throw new BadRequestError('评论内容不能超过 2000 个字符');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) throw new BadRequestError('邮箱格式不正确');
  if (hasSpamPattern(content)) throw new BadRequestError('评论包含过多异常内容');

  const post = findRecord('posts', postId);
  if (!post || post.get('status') !== 'published') throw new BadRequestError('只能评论已发布文章');

  if (parentId) {
    const parent = findRecord('comments', parentId);
    if (!parent || parent.get('post_id') !== postId || parent.get('status') !== 'approved') {
      throw new BadRequestError('只能回复已公开的同一篇文章评论');
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
  if (ip) record.set('ip_address', ip);

  e.next();
}, 'comments');
