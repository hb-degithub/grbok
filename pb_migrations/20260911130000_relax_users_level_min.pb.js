/// <reference path="../pb_data/types.d.ts" />

// 放宽 users.level 最小值约束：1 → 0。
//
// 背景：level 字段定义为 number min=1，但 number 类型未显式赋值时按 DEFAULT 0
// 落库（注册/后台建用户等未走初始化逻辑的路径都会产生 level=0 记录）。
// 后果：user_level_up.pb.js 给 level=0 用户更新统计时，saveRecord 因 0 < min(1)
// 校验失败，stats/experience 永远无法更新，等级系统整体失效（日志表现为
// [user-level] operation=upgrade result=INTERNAL_ERROR）。
//
// 业务语义上 level 有效值为 1-5（checkAndUpgradeUser 以 `getInt('level') || 1`
// 兼容 0），放宽 min=0 仅承认"未初始化"的默认态，不改变升级逻辑。
// 配套：registration_facade 创建用户时已补齐 level=1 等初始化字段（治本），
// 本迁移是防御纵深（其他创建路径不会再踩雷）。
//
// 注意：PocketBase 迁移脚本禁用原生数组高阶方法（参考项目已知陷阱）。

migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId('users');
  if (!users) throw new Error('users collection is required');

  const field = users.schema.getFieldByName('level');
  if (!field) throw new Error('users.level field is required');
  field.options = field.options || {};
  field.options.min = 0;

  dao.saveCollection(users);
}, (db) => {
  // 回滚：恢复 min=1。注意：回滚前需确保不存在 level=0 的用户，
  // 否则这些记录后续 save 会校验失败（这正是本迁移要消除的状态）。
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId('users');
  if (!users) return;

  try {
    const field = users.schema.getFieldByName('level');
    if (field && field.options) {
      field.options.min = 1;
      dao.saveCollection(users);
    }
  } catch (_) {}
});
