/// <reference path="../pb_data/types.d.ts" />

// 用户等级系统：level/experience/stats/level_config
// 注意：PocketBase 迁移脚本禁用原生数组方法（参考项目已知陷阱）

migrate((db) => {
  const dao = new Dao(db);

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  // 1. users 集合新增等级字段
  const users = dao.findCollectionByNameOrId('users');
  if (!users) throw new Error('users collection is required');

  // 用户等级（1-5）
  ensureField(users, { name: 'level', type: 'number', required: false, options: { min: 1, max: 5 } });
  // 等级经验值
  ensureField(users, { name: 'experience', type: 'number', required: false, options: { min: 0, max: null } });
  // VIP 到期时间
  ensureField(users, { name: 'vip_expire_at', type: 'date', required: false });
  // 用户统计（JSON）
  ensureField(users, { name: 'stats', type: 'json', required: false });
  // 等级配置（JSON）
  ensureField(users, { name: 'level_config', type: 'json', required: false });
  // 等级变更历史（JSON）
  ensureField(users, { name: 'level_history', type: 'json', required: false });

  dao.saveCollection(users);

  // 2. 初始化现有用户的等级数据
  const existingUsers = dao.findRecordsByFilter('users', 'id != ""', '', 500, 0);
  for (const user of existingUsers) {
    // 跳过已有等级数据的用户
    if (user.get('level')) continue;

    user.set('level', 1);
    user.set('experience', 0);
    user.set('stats', {
      comment_count: 0,
      like_received: 0,
      article_views: 0,
      login_days: 0,
      last_login_at: null,
    });
    user.set('level_config', {
      pinned_comments_limit: 0,
      badge_style: 'default',
      avatar_frame: 'none',
      custom_title: '',
    });
    user.set('level_history', []);
    dao.saveRecord(user);
  }

  // 3. 新增 level_rules 集合（等级规则配置）
  let levelRules;
  try {
    levelRules = dao.findCollectionByNameOrId('level_rules');
  } catch (_) {
    levelRules = new Collection({
      name: 'level_rules',
      type: 'base',
      system: false,
      schema: [],
    });
  }

  ensureField(levelRules, { name: 'level', type: 'number', required: true, options: { min: 1, max: 5 } });
  ensureField(levelRules, { name: 'name', type: 'text', required: true, options: { min: 1, max: 50, pattern: '' } });
  ensureField(levelRules, { name: 'description', type: 'text', required: false, options: { min: 0, max: 200, pattern: '' } });
  ensureField(levelRules, { name: 'upgrade_conditions', type: 'json', required: false });
  ensureField(levelRules, { name: 'benefits', type: 'json', required: false });
  ensureField(levelRules, { name: 'is_active', type: 'bool', required: false });
  ensureField(levelRules, { name: 'sort_order', type: 'number', required: false, options: { min: 0, max: null } });

  // 只有管理员可以管理等级规则
  levelRules.listRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  levelRules.viewRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  levelRules.createRule = '@request.auth.role = "super_admin"';
  levelRules.updateRule = '@request.auth.role = "super_admin"';
  levelRules.deleteRule = '@request.auth.role = "super_admin"';

  dao.saveCollection(levelRules);

  // 4. 新增 user_levels_log 集合（等级变更日志）
  let levelLog;
  try {
    levelLog = dao.findCollectionByNameOrId('user_levels_log');
  } catch (_) {
    levelLog = new Collection({
      name: 'user_levels_log',
      type: 'base',
      system: false,
      schema: [],
    });
  }

  ensureField(levelLog, { name: 'user', type: 'relation', required: true, options: { collectionId: users.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['name', 'email'] } });
  ensureField(levelLog, { name: 'old_level', type: 'number', required: true, options: { min: 1, max: 5 } });
  ensureField(levelLog, { name: 'new_level', type: 'number', required: true, options: { min: 1, max: 5 } });
  ensureField(levelLog, { name: 'reason', type: 'text', required: true, options: { min: 1, max: 50, pattern: '' } });
  ensureField(levelLog, { name: 'trigger_data', type: 'json', required: false });

  // 只有管理员可以查看日志
  levelLog.listRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  levelLog.viewRule = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  levelLog.createRule = null; // 只允许服务端创建
  levelLog.updateRule = null;
  levelLog.deleteRule = '@request.auth.role = "super_admin"';

  dao.saveCollection(levelLog);

  // 5. 插入默认等级规则
  const defaultRules = [
    { level: 1, name: '注册用户', description: '注册账号即可', upgrade_conditions: [], benefits: { pinned_comments: 0 }, is_active: true, sort_order: 1 },
    { level: 2, name: '活跃用户', description: '注册满7天且评论≥10条', upgrade_conditions: [{ type: 'register_days', value: 7, operator: '>=' }, { type: 'comment_count', value: 10, operator: '>=' }], benefits: { pinned_comments: 1 }, is_active: true, sort_order: 2 },
    { level: 3, name: '资深用户', description: '注册满30天且评论≥50条且获赞≥100', upgrade_conditions: [{ type: 'register_days', value: 30, operator: '>=' }, { type: 'comment_count', value: 50, operator: '>=' }, { type: 'like_received', value: 100, operator: '>=' }], benefits: { pinned_comments: 3, comment_priority: true }, is_active: true, sort_order: 3 },
    { level: 4, name: 'VIP会员', description: '付费订阅', upgrade_conditions: [{ type: 'vip_purchase', value: 1, operator: '=' }], benefits: { pinned_comments: 5, ad_free: true, vip_content: true }, is_active: true, sort_order: 4 },
    { level: 5, name: '荣誉会员', description: '邀请制（管理员授予）', upgrade_conditions: [{ type: 'admin_grant', value: 1, operator: '=' }], benefits: { pinned_comments: null, ad_free: true, vip_content: true, priority_support: true }, is_active: true, sort_order: 5 },
  ];

  for (const rule of defaultRules) {
    try {
      // 检查是否已存在
      const existing = dao.findFirstRecordByFilter('level_rules', 'level = {:level}', { level: rule.level });
      if (existing) continue;

      const record = new Record(levelRules);
      record.set('level', rule.level);
      record.set('name', rule.name);
      record.set('description', rule.description);
      record.set('upgrade_conditions', rule.upgrade_conditions);
      record.set('benefits', rule.benefits);
      record.set('is_active', rule.is_active);
      record.set('sort_order', rule.sort_order);
      dao.saveRecord(record);
    } catch (_) {}
  }
}, (db) => {
  // 回滚：删除新增字段和集合
  const dao = new Dao(db);

  try {
    const users = dao.findCollectionByNameOrId('users');
    if (users) {
      const fieldsToRemove = ['level', 'experience', 'vip_expire_at', 'stats', 'level_config', 'level_history'];
      for (const name of fieldsToRemove) {
        try {
          const field = users.schema.getFieldByName(name);
          if (field) users.schema.removeField(field.id);
        } catch (_) {}
      }
      dao.saveCollection(users);
    }
  } catch (_) {}

  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('level_rules'));
  } catch (_) {}

  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('user_levels_log'));
  } catch (_) {}
});
