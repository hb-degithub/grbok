/// <reference path="../pb_data/types.d.ts" />

// 修复评论提交 400：线上 comments 集合把 author_email、status 设为必填，
// 而前端契约（commentService.submitComment）永不发送 status、匿名时发送空 author_email，
// schema 校验先于 hook 导致访客评论必然 400（2026-08-31 生产实测）。
// validate_comment.pb.js 的设计即 hook 层兜底 status/邮箱可选，此处将两字段放开为非必填。
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  const comments = dao.findCollectionByNameOrId('comments');
  if (!comments) throw new Error('comments collection is required');

  const names = ['author_email', 'status'];
  for (const name of names) {
    try {
      const field = comments.schema.getFieldByName(name);
      if (field && field.id) {
        field.required = false;
      }
    } catch (_) {}
  }

  dao.saveCollection(comments);
}, (db) => {
  // 回滚：恢复两字段必填
  const dao = new Dao(db);

  try {
    const comments = dao.findCollectionByNameOrId('comments');
    if (comments) {
      const names = ['author_email', 'status'];
      for (const name of names) {
        try {
          const field = comments.schema.getFieldByName(name);
          if (field && field.id) {
            field.required = true;
          }
        } catch (_) {}
      }
      dao.saveCollection(comments);
    }
  } catch (_) {}
});
