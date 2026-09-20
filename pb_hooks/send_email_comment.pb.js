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
    } catch (err) {
      console.error('[comment-mail] operation=enqueue result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200));
    }
    if (typeof e.next === 'function') e.next();
  }, 'comments');

  // AI 回复草稿由 worker 经 DAO 创建（不触发 create 钩子），管理员在后台点"通过"后
  // 经 SDK update（status pending → approved）——这里补发被回复者通知。
  // 处理器对任何 comments update 都触发，因此先看 is_ai 提前返回，避免无谓开销。
  // 注意：handler 在请求级 runtime 重新 eval，不能引用 IIFE 闭包，必须自包含。
  onRecordAfterUpdateRequest(function (e) {
    try {
      var record = e.record;
      // 非 AI 回复或未通过：直接跳过（本处理器对任何 comments update 都会触发）
      if (record && record.get('is_ai') === true && record.getString('status') === 'approved') {
        var parentId = String(record.getString('parent_id') || '').trim();
        if (parentId) {
          // 复用 create 处理器"收件人2（被回复评论作者）"的查找/偏好检查/变量组装逻辑
          var post = $app.dao().findRecordById('posts', record.getString('post_id'));
          var commenter = String(record.getString('author_name') || '').trim();
          var commenterEmail = String(record.getString('author_email') || '').trim().toLowerCase();
          var base = String($os.getenv('PUBLIC_SITE_URL') || $app.settings().meta.appUrl || 'https://hlydwz.com').replace(/\/$/, '');
          var postUrl = base + '/posts/' + encodeURIComponent(post.getString('slug') || post.id);

          var parentComment = $app.dao().findRecordById('comments', parentId);
          var parentAuthorUserId = parentComment.getString('author_user');

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
        }
      }
    } catch (err) {
      // 通知失败不影响审核操作
      console.error('[comment-mail] operation=enqueue-ai-reply result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200));
    }
    if (typeof e.next === 'function') e.next();
  }, 'comments');
})();
