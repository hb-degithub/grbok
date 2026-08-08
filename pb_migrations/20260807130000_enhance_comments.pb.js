/// <reference path="../pb_data/types.d.ts" />

// 评论系统完善：点赞、举报、编辑/删除、通知偏好
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  // 1. comments 集合新增字段
  const comments = dao.findCollectionByNameOrId('comments');
  if (!comments) throw new Error('comments collection is required');

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  // 点赞数
  ensureField(comments, { name: 'likes', type: 'number', required: false, options: { min: 0, max: null } });
  // 编辑标记
  ensureField(comments, { name: 'edited', type: 'bool', required: false });
  // 编辑时间
  ensureField(comments, { name: 'edited_at', type: 'date', required: false });
  // 软删除标记
  ensureField(comments, { name: 'deleted', type: 'bool', required: false });

  dao.saveCollection(comments);

  // 2. 新增 comment_reports 集合
  let reports;
  try {
    reports = dao.findCollectionByNameOrId('comment_reports');
  } catch (_) {
    reports = new Collection({
      name: 'comment_reports',
      type: 'base',
      system: false,
      schema: [],
    });
  }

  ensureField(reports, { name: 'comment_id', type: 'relation', required: true, options: { collectionId: comments.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['content'] } });
  ensureField(reports, { name: 'reporter_ip', type: 'text', required: true, options: { min: 1, max: 45, pattern: '' } });
  ensureField(reports, { name: 'reason', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
  ensureField(reports, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['pending', 'reviewed', 'dismissed'] } });

  // 只有管理员可以查看/处理举报
  reports.listRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  reports.viewRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  reports.createRule = ''; // 任何人都可以举报
  reports.updateRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  reports.deleteRule = '@request.auth.role = "super_admin"';

  dao.saveCollection(reports);

  // 3. users 集合新增通知偏好字段
  const users = dao.findCollectionByNameOrId('users');
  if (users) {
    ensureField(users, { name: 'notify_comment_reply', type: 'bool', required: false });
    dao.saveCollection(users);
  }
}, (db) => {
  // 回滚：删除新增字段和集合
  const dao = new Dao(db);

  try {
    const comments = dao.findCollectionByNameOrId('comments');
    if (comments) {
      const fieldsToRemove = ['likes', 'edited', 'edited_at', 'deleted'];
      for (const name of fieldsToRemove) {
        try {
          const field = comments.schema.getFieldByName(name);
          if (field) comments.schema.removeField(field.id);
        } catch (_) {}
      }
      dao.saveCollection(comments);
    }
  } catch (_) {}

  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('comment_reports'));
  } catch (_) {}

  try {
    const users = dao.findCollectionByNameOrId('users');
    if (users) {
      try {
        const field = users.schema.getFieldByName('notify_comment_reply');
        if (field) users.schema.removeField(field.id);
        dao.saveCollection(users);
      } catch (_) {}
    }
  } catch (_) {}
});
