(function () {
/// <reference path="../pb_data/types.d.ts" />

// 用户等级自动升级机制
// 评论创建后更新统计并检查升级

onRecordAfterCreateRequest(function (e) {
  var record = e.record;
  if (!record) return;

  try {
    var authorUserId = String(record.getString('author_user') || '').trim();
    if (!authorUserId) return; // 匿名评论不升级

    // 使用事务防止并发丢更新
    $app.dao().runInTransaction(function (txDao) {
      var user = txDao.findRecordById('users', authorUserId);
      if (!user) return;

      // 更新统计
      var stats = user.get('stats') || {};
      stats.comment_count = (stats.comment_count || 0) + 1;
      user.set('stats', stats);

      // 增加经验值（评论 +5）
      var currentExp = user.getInt('experience') || 0;
      user.set('experience', currentExp + 5);

      txDao.saveRecord(user);

      // 检查升级
      checkAndUpgradeUser(user);
    });
  } catch (_) {
    console.error('[user-level] operation=upgrade result=INTERNAL_ERROR');
  }

  if (typeof e.next === 'function') e.next();
}, 'comments');

// 点赞后更新获赞统计
onRecordAfterUpdateRequest(function (e) {
  var record = e.record;
  if (!record) return;

  try {
    // 检查是否是点赞操作（likes 字段增加）
    var oldLikes = record.original().getInt('likes') || 0;
    var newLikes = record.getInt('likes') || 0;
    if (newLikes <= oldLikes) return;

    var authorUserId = String(record.getString('author_user') || '').trim();
    if (!authorUserId) return;

    // 使用事务防止并发丢更新
    $app.dao().runInTransaction(function (txDao) {
      var user = txDao.findRecordById('users', authorUserId);
      if (!user) return;

      // 更新获赞统计
      var stats = user.get('stats') || {};
      stats.like_received = (stats.like_received || 0) + (newLikes - oldLikes);
      user.set('stats', stats);

      // 增加经验值（获赞 +10）
      var currentExp = user.getInt('experience') || 0;
      user.set('experience', currentExp + 10);

      txDao.saveRecord(user);

      // 检查升级
      checkAndUpgradeUser(user);
    });
  } catch (_) {
    console.error('[user-level] operation=like-upgrade result=INTERNAL_ERROR');
  }

  if (typeof e.next === 'function') e.next();
}, 'comments');

/**
 * 检查并升级用户等级
 */
function checkAndUpgradeUser(user) {
  var currentLevel = user.getInt('level') || 1;
  if (currentLevel >= 5) return; // 已是最高等级

  var nextLevel = currentLevel + 1;

  // 获取下一级规则
  var rule;
  try {
    rule = $app.dao().findFirstRecordByFilter('level_rules', 'level = {:level} && is_active = true', { level: nextLevel });
  } catch (_) {
    return; // 规则不存在
  }

  if (!rule) return;

  // 检查升级条件
  var conditions = rule.get('upgrade_conditions') || [];
  var stats = user.get('stats') || {};
  var registerDays = Math.floor((Date.now() - new Date(user.get('created')).getTime()) / (1000 * 60 * 60 * 24));

  var canUpgrade = true;
  for (var i = 0; i < conditions.length; i++) {
    var condition = conditions[i];
    var value = condition.value;
    var operator = condition.operator || '>=';

    var actualValue;
    switch (condition.type) {
      case 'register_days':
        actualValue = registerDays;
        break;
      case 'comment_count':
        actualValue = stats.comment_count || 0;
        break;
      case 'like_received':
        actualValue = stats.like_received || 0;
        break;
      default:
        continue;
    }

    // 比较
    var satisfied = false;
    switch (operator) {
      case '>=': satisfied = actualValue >= value; break;
      case '>': satisfied = actualValue > value; break;
      case '<=': satisfied = actualValue <= value; break;
      case '<': satisfied = actualValue < value; break;
      case '=': satisfied = actualValue === value; break;
    }

    if (!satisfied) {
      canUpgrade = false;
      break;
    }
  }

  if (!canUpgrade) return;

  // 执行升级
  var oldLevel = user.getInt('level') || 1;
  user.set('level', nextLevel);

  // 更新权益配置
  var benefits = rule.get('benefits') || {};
  var levelConfig = user.get('level_config') || {};
  levelConfig.pinned_comments_limit = benefits.pinned_comments !== undefined ? benefits.pinned_comments : 0;
  user.set('level_config', levelConfig);

  // 记录变更历史
  var history = user.get('level_history') || [];
  history.push({
    level: nextLevel,
    changed_at: new Date().toISOString(),
    reason: 'auto_upgrade',
  });
  user.set('level_history', history);

  $app.dao().saveRecord(user);

  // 写入日志
  try {
    var log = new Record($app.dao().findCollectionByNameOrId('user_levels_log'));
    log.set('user', user.id);
    log.set('old_level', oldLevel);
    log.set('new_level', nextLevel);
    log.set('reason', 'auto_upgrade');
    log.set('trigger_data', { stats: stats, registerDays: registerDays });
    $app.dao().saveRecord(log);
  } catch (_) {}
}
})();
