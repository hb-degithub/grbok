(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 定时发布 cron -- 每分钟检查待发布的草稿
  // posts 表用 published_at 字段存储计划发布时间
  //
  // 逻辑：找出 status = "draft" 且 published_at 已设置且 <= now 的文章，
  // 切换为 published。仅 draft 会被发布，archived 不会被误触发。
  // 资产保护：仅操作 PocketBase 数据，不修改任何前端文件

  cronAdd('scheduled-publish', '* * * * *', function () {
    const now = new Date().toISOString();

    const drafts = $app.dao().findRecordsByFilter(
      'posts',
      'status = "draft" && published_at != null && published_at <= {:now}',
      'published_at',
      100,
      0,
      { now: now },
    );

    for (const post of drafts) {
      post.set('status', 'published');
      $app.dao().saveRecord(post);

      // 写审计日志（summary 截断到 500 字符以内，与 audit_admin_actions.pb.js 一致）
      try {
        const auditCollection = $app.dao().findCollectionByNameOrId('audit_logs');
        const title = (post.getString('title') || '').slice(0, 450);
        const log = new Record(auditCollection, {
          actor: 'system',
          action: 'scheduled_publish',
          target_collection: 'posts',
          target_id: post.id,
          summary: '定时发布自动触发: ' + title,
          ip: '',
          user_agent: 'pocketbase-cron',
        });
        $app.dao().saveRecord(log);
      } catch (_) {
        // 审计日志失败不影响发布
      }

      console.log('[scheduled-publish] post published: ' + post.id);
    }
  });
})();
