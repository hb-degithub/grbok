(function () {
  onRecordAfterCreateRequest(function (e) {
    var record = e.record;
    try {
      var post = $app.dao().findRecordById('posts', record.getString('post_id'));
      var authorId = post.getString('author');
      var commenter = String(record.getString('author_name') || '').trim();
      var commenterEmail = String(record.getString('author_email') || '').trim().toLowerCase();
      var base = String($os.getenv('PUBLIC_SITE_URL') || $app.settings().meta.appUrl || 'https://hlydwz.com').replace(/\/$/, '');
      var postUrl = base + '/posts/' + encodeURIComponent(post.getString('slug') || post.id);
      
      // 1. 通知文章作者（如果开启通知）
      if (authorId) {
        var author = $app.dao().findRecordById('users', authorId);
        var recipient = String(author.getString('email') || '').trim().toLowerCase();
        var notifyPostComment = author.getBool('notify_post_comment');
        
        // 检查是否开启通知，且不是作者自己评论
        if (recipient && notifyPostComment !== false && commenterEmail !== recipient) {
          $app.dao().runInTransaction(function (txDao) {
            require(__hooks + '/lib/mail_outbox.js').enqueue(txDao, {
              dedupeKey: 'comment:' + record.id + ':author:' + authorId,
              category: 'comment_notification', recipient: recipient, templateKey: 'comment_new',
              variables: { postTitle: post.getString('title'), commenter: commenter || '读者', content: record.getString('content'), postUrl: postUrl },
            });
          });
        }
      }
      
      // 2. 通知被回复的评论作者（如果是回复评论）
      var parentId = String(record.getString('parent_id') || '').trim();
      if (parentId) {
        try {
          var parentComment = $app.dao().findRecordById('comments', parentId);
          var parentAuthorUserId = parentComment.getString('author_user');
          var parentAuthorEmail = String(parentComment.getString('author_email') || '').trim().toLowerCase();
          
          // 只通知注册用户（有 author_user 关联）
          if (parentAuthorUserId) {
            var parentAuthor = $app.dao().findRecordById('users', parentAuthorUserId);
            var parentRecipient = String(parentAuthor.getString('email') || '').trim().toLowerCase();
            var notifyCommentReply = parentAuthor.getBool('notify_comment_reply');
            
            // 检查是否开启通知，且不是回复自己的评论
            if (parentRecipient && notifyCommentReply !== false && commenterEmail !== parentRecipient) {
              $app.dao().runInTransaction(function (txDao) {
                require(__hooks + '/lib/mail_outbox.js').enqueue(txDao, {
                  dedupeKey: 'comment_reply:' + record.id + ':parent:' + parentId,
                  category: 'comment_reply_notification', recipient: parentRecipient, templateKey: 'comment_reply',
                  variables: { 
                    postTitle: post.getString('title'), 
                    commenter: commenter || '读者', 
                    content: record.getString('content'), 
                    postUrl: postUrl,
                    parentCommenter: parentComment.getString('author_name') || '读者',
                    parentContent: parentComment.getString('content') || ''
                  },
                });
              });
            }
          }
        } catch (parentError) {
          // 父评论不存在或已被删除：预期场景，静默忽略回复通知（不记录敏感标识）
        }
      }
    } catch (_) {
      console.error('[comment-mail] operation=enqueue result=INTERNAL_ERROR');
    }
    if (typeof e.next === 'function') e.next();
  }, 'comments');
})();
