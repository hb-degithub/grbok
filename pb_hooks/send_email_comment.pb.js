function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function trimTrailingSlash(value) {
  const text = String(value || '');
  return text.endsWith('/') ? text.slice(0, -1) : text;
}

onRecordAfterCreateRequest((e) => {
  const record = e.record;
  const postId = record.get('post_id');
  const authorEmail = cleanHeader(record.get('author_email'));

  try {
    const post = $app.dao().findRecordById('posts', postId);
    const postTitle = cleanHeader(post.get('title'));
    const postSlug = cleanHeader(post.get('slug') || postId);
    const authorId = post.get('author');
    if (!authorId) return;

    const author = $app.dao().findRecordById('users', authorId);
    const postAuthorEmail = cleanHeader(author.get('email'));
    if (!postAuthorEmail || postAuthorEmail === authorEmail) return;

    const appUrl = trimTrailingSlash($app.settings().meta.appUrl || 'https://hlydwz.com');
    const postUrl = appUrl + '/posts/' + encodeURIComponent(postSlug);
    const message = new MailerMessage({
      from: {
        address: $app.settings().meta.senderAddress,
        name: $app.settings().meta.senderName,
      },
      to: [{ address: postAuthorEmail }],
      subject: '新评论: ' + postTitle,
      html: [
        '<h2>你的文章收到新评论</h2>',
        '<p><strong>文章:</strong> ' + escapeHtml(postTitle) + '</p>',
        '<p><strong>评论者:</strong> ' + escapeHtml(authorEmail) + '</p>',
        '<blockquote>' + escapeHtml(record.get('content')) + '</blockquote>',
        '<p><a href="' + escapeHtml(postUrl) + '">查看文章</a></p>',
      ].join(''),
    });

    $app.newMailClient().send(message);
  } catch (err) {
    console.error('[comment-mail] failed:', err);
  }
}, 'comments');
