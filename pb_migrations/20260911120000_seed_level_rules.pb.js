/// <reference path="../pb_data/types.d.ts" />

// 补种用户等级规则并修正 level=0 用户数据。
//
// 背景：20260808120000_add_user_levels.pb.js 第 5 步的种子循环把
//「查找是否已存在」与「插入」放在同一个 try 里——DAO 的
// findFirstRecordByFilter 在无匹配记录时返回 sql.ErrNoRows（JSVM 表现为抛错），
// 被外层 catch (_) {} 吞掉，导致 5 条默认规则全部没有插入，生产 level_rules 为空，
// 用户永远无法自动升级。本迁移用正确的存在性检查补插，幂等可重入。
//
// 同时修正 level=0 的用户：users.level 字段定义为 min=1，但 number 类型默认值 0
// 落库（迁移之后注册的新用户未走初始化逻辑），与 checkAndUpgradeUser 的
// `getInt('level') || 1` 语义对齐为 1，并补齐 stats/level_config/level_history。
//
// 注意：PocketBase 迁移脚本禁用原生数组高阶方法（参考项目已知陷阱）。

migrate((db) => {
  const dao = new Dao(db);

  // ---------- 1. 补种等级规则 ----------
  let levelRules = null;
  try {
    levelRules = dao.findCollectionByNameOrId('level_rules');
  } catch (_) {
    levelRules = null;
  }

  if (levelRules) {
    const defaultRules = [
      { level: 1, name: '注册用户', description: '注册账号即可', upgrade_conditions: [], benefits: { pinned_comments: 0 }, is_active: true, sort_order: 1 },
      { level: 2, name: '活跃用户', description: '注册满7天且评论≥10条', upgrade_conditions: [{ type: 'register_days', value: 7, operator: '>=' }, { type: 'comment_count', value: 10, operator: '>=' }], benefits: { pinned_comments: 1 }, is_active: true, sort_order: 2 },
      { level: 3, name: '资深用户', description: '注册满30天且评论≥50条且获赞≥100', upgrade_conditions: [{ type: 'register_days', value: 30, operator: '>=' }, { type: 'comment_count', value: 50, operator: '>=' }, { type: 'like_received', value: 100, operator: '>=' }], benefits: { pinned_comments: 3, comment_priority: true }, is_active: true, sort_order: 3 },
      { level: 4, name: 'VIP会员', description: '付费订阅', upgrade_conditions: [{ type: 'vip_purchase', value: 1, operator: '=' }], benefits: { pinned_comments: 5, ad_free: true, vip_content: true }, is_active: true, sort_order: 4 },
      { level: 5, name: '荣誉会员', description: '邀请制（管理员授予）', upgrade_conditions: [{ type: 'admin_grant', value: 1, operator: '=' }], benefits: { pinned_comments: null, ad_free: true, vip_content: true, priority_support: true }, is_active: true, sort_order: 5 },
    ];

    for (let i = 0; i < defaultRules.length; i++) {
      const rule = defaultRules[i];
      // 存在性检查必须独立 try：查不到记录时 findFirstRecordByFilter 抛错，
      // 不能与插入逻辑共用一个 try（这正是 20260808120000 种子丢失的根因）。
      let existing = null;
      try {
        existing = dao.findFirstRecordByFilter('level_rules', 'level = {:level}', { level: rule.level });
      } catch (_) {
        existing = null;
      }
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
    }
  }

  // ---------- 2. 修正 level=0 用户 ----------
  const zeroLevelUsers = dao.findRecordsByFilter('users', 'level = 0', '', 500, 0);
  for (let i = 0; i < zeroLevelUsers.length; i++) {
    const user = zeroLevelUsers[i];
    user.set('level', 1);
    if (!user.get('stats')) {
      user.set('stats', {
        comment_count: 0,
        like_received: 0,
        article_views: 0,
        login_days: 0,
        last_login_at: null,
      });
    }
    if (!user.get('level_config')) {
      user.set('level_config', {
        pinned_comments_limit: 0,
        badge_style: 'default',
        avatar_frame: 'none',
        custom_title: '',
      });
    }
    if (!user.get('level_history')) {
      user.set('level_history', []);
    }
    dao.saveRecord(user);
  }
}, (db) => {
  // 回滚：仅删除本迁移补种的 5 条规则（按 name 精确匹配，避免误删管理员后续修改）；
  // 用户 level 修正不回滚（1 是字段定义内的合法最小值，回滚反而制造脏数据）。
  const dao = new Dao(db);

  const seedNames = ['注册用户', '活跃用户', '资深用户', 'VIP会员', '荣誉会员'];
  for (let i = 0; i < seedNames.length; i++) {
    try {
      const record = dao.findFirstRecordByFilter('level_rules', 'name = {:name}', { name: seedNames[i] });
      if (record) dao.deleteRecord(record);
    } catch (_) {}
  }
});
