(function () {
  onRecordAfterCreateRequest(function (e) {
    var record = e.record;
    try {
      var post = $app.dao().findRecordById('posts', record.getString('post_id'));
      var authorId = post.getString('author');
      if (!authorId) return;
      var author = $app.dao().findRecordById('users', authorId);
      var recipient = String(author.getString('email') || '').trim().toLowerCase();
      var commenter = String(record.getString('author_name') || '').trim();
      if (!recipient || (record.getString('author_email') || '').trim().toLowerCase() === recipient) return;
      var base = String($os.getenv('PUBLIC_SITE_URL') || $app.settings().meta.appUrl || 'https://hlydwz.com').replace(/\/$/, '');
      $app.dao().runInTransaction(function (txDao) {
        require(__hooks + '/lib/mail_outbox.js').enqueue(txDao, {
          dedupeKey: 'comment:' + record.id + ':author:' + authorId,
          category: 'comment_notification', recipient: recipient, templateKey: 'comment_new',
          variables: { postTitle: post.getString('title'), commenter: commenter || '读者', content: record.getString('content'), postUrl: base + '/posts/' + encodeURIComponent(post.getString('slug') || post.id) },
        });
      });
    } catch (error) {
      console.error('[comment-mail] enqueue failed:', String(error && error.message ? error.message : error));
    }
    if (typeof e.next === 'function') e.next();
  }, 'comments');
})();
