'use strict';

// 用户等级自动升级业务逻辑（从 user_level_up.pb.js 剥离）
// 背景：PB 0.22 JSVM 的 onRecord* 回调按源码字符串在请求级 runtime 重新 eval，
// 访问不到 .pb.js 文件的 IIFE 闭包变量，因此全部逻辑收在本 lib，
// 路由壳回调内 require 调用（与 login_security/stats_track 同款模式）。

// PB 0.27 goja 里 record.get() 对 JSON 字段返回 Go JSONRaw（[]byte 类数组，
// .length 是字节数而非元素数），不能直接当 JS 对象用。正确读法是
// record.getString() 拿 JSON 文本再 JSON.parse（2026-09-11 探针实测）。
function toJS(record, field, fallback) {
  try {
    var raw = record.getString(field);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function upgradeStats(txDao, authorUserId, updater, expGain, opLabel) {
  if (!authorUserId) return;
  try {
    var user = txDao.findRecordById('users', authorUserId);
    if (!user) return;

    var stats = toJS(user, 'stats', {});
    updater(stats);
    user.set('stats', stats);

    var currentExp = user.getInt('experience') || 0;
    user.set('experience', currentExp + expGain);

    txDao.saveRecord(user);

    checkAndUpgradeUser(txDao, user);
  } catch (err) {
    // 打印具体错误便于定位（此前静默吞错导致等级失效数周才被发现）
    console.error('[user-level] operation=' + opLabel + ' result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200));
  }
}

// 评论创建后更新统计并检查升级（onRecordAfterCreateRequest 回调）
function onCommentCreated(e) {
  var record = e.record;
  if (!record) return;
  var authorUserId = String(record.getString('author_user') || '').trim();
  if (!authorUserId) return; // 匿名评论不升级

  // 使用事务防止并发丢更新
  $app.dao().runInTransaction(function (txDao) {
    upgradeStats(txDao, authorUserId, function (stats) {
      stats.comment_count = (stats.comment_count || 0) + 1;
    }, 5, 'upgrade');
  });

  if (typeof e.next === 'function') e.next();
}

// 管理员后台修改评论 likes 时同步获赞统计（onRecordAfterUpdateRequest 回调）
// 注意：自定义点赞路由（comment_actions_lib likeComment）是 DAO 级保存，
// 不触发本 hook——点赞场景的统计走 addLikeReceived 直接调用。
function onCommentUpdated(e) {
  var record = e.record;
  if (!record) return;

  try {
    // 检查是否是点赞操作（likes 字段增加）
    var oldLikes = record.original().getInt('likes') || 0;
    var newLikes = record.getInt('likes') || 0;
    if (newLikes <= oldLikes) return;

    var authorUserId = String(record.getString('author_user') || '').trim();
    if (!authorUserId) return;

    var delta = newLikes - oldLikes;
    $app.dao().runInTransaction(function (txDao) {
      upgradeStats(txDao, authorUserId, function (stats) {
        stats.like_received = (stats.like_received || 0) + delta;
      }, 10, 'like-upgrade');
    });
  } catch (err) {
    console.error('[user-level] operation=like-upgrade result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200));
  }

  if (typeof e.next === 'function') e.next();
}

// 点赞路由内直接调用（复用调用方事务，避免嵌套开事务产生锁等待）
function addLikeReceived(txDao, authorUserId, delta) {
  if (!authorUserId || !delta) return;
  upgradeStats(txDao, authorUserId, function (stats) {
    stats.like_received = (stats.like_received || 0) + delta;
  }, 10 * delta, 'like-received');
}

/**
 * 检查并升级用户等级
 * 注意：必须全程使用调用方传入的 txDao。在写事务持有 SQLite 写锁时，
 * 用 $app.dao()（另一连接）读写会触发锁等待乃至自死锁（2026-09-11 实测
 * 导致 PB 全库 database is locked）。
 */
function checkAndUpgradeUser(txDao, user) {
  var currentLevel = user.getInt('level') || 1;
  if (currentLevel >= 5) return; // 已是最高等级

  var nextLevel = currentLevel + 1;

  // 获取下一级规则
  var rule;
  try {
    rule = txDao.findFirstRecordByFilter('level_rules', 'level = {:level} && is_active = true', { level: nextLevel });
  } catch (_) {
    return; // 规则不存在
  }

  if (!rule) return;

  // 检查升级条件
  var conditions = toJS(rule, 'upgrade_conditions', []);
  var stats = toJS(user, 'stats', {});
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
  var benefits = toJS(rule, 'benefits', {});
  var levelConfig = toJS(user, 'level_config', {});
  levelConfig.pinned_comments_limit = benefits.pinned_comments !== undefined && benefits.pinned_comments !== null ? benefits.pinned_comments : 0;
  user.set('level_config', levelConfig);

  // 记录变更历史
  var history = toJS(user, 'level_history', []);
  history.push({
    level: nextLevel,
    changed_at: new Date().toISOString(),
    reason: 'auto_upgrade',
  });
  user.set('level_history', history);

  txDao.saveRecord(user);

  // 写入日志
  try {
    var log = new Record(txDao.findCollectionByNameOrId('user_levels_log'));
    log.set('user', user.id);
    log.set('old_level', oldLevel);
    log.set('new_level', nextLevel);
    log.set('reason', 'auto_upgrade');
    log.set('trigger_data', { stats: stats, registerDays: registerDays });
    txDao.saveRecord(log);
  } catch (_) {}
}

module.exports = {
  onCommentCreated: onCommentCreated,
  onCommentUpdated: onCommentUpdated,
  addLikeReceived: addLikeReceived,
};
