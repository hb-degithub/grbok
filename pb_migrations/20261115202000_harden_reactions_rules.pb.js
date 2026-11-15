/// <reference path="../pb_data/types.d.ts" />

// 2026-11-15 静态缺陷修复：收紧 reactions 集合的 API 规则。
//
// 背景：20260629006000_create_reactions.pb.js 把 listRule / viewRule / createRule 设成空字符串
// （"" 在 PocketBase 里表示「匿名可访问」），而 reactions 行内含客户端提交的 fingerprint
// （text, max 128）与 user_id 关系。实测匿名 GET /api/collections/reactions/records 返回 200，
// 可批量枚举访客指纹并按 fingerprint 关联到用户，也可匿名伪造 reaction 写入。
//
// 本迁移把 5 条规则全部置为 null：该集合仅允许服务端（superuser 会话、DAO、pb_hooks）访问。
// 管理后台的统计读取走 superuser 客户端（astro/src/lib/services/insightsService.ts），
// superuser 不受 API 规则限制，因此后台功能不受影响；匿名与普通读者对 reactions 的
// REST 读写被拒。
//
// 本迁移刻意不做的事：
// 1) 不删除任何数据行。历史 fingerprint 与匿名 reaction 记录的清理属于人工操作：
//    先备份 pb_data（生产为 Docker volume），再按 created 区间人工删除并保留审计记录。
// 2) down 迁移恒为空操作，不恢复此前的公开规则。理由：把 "" 写回去等于重新打开
//    指纹枚举与匿名伪造写入面；若确需回滚，应由人工评估风险后单独新增一个显式迁移，
//    而不是让 migrate down 静默放开。
// 3) 只用直接赋值，不使用原生数组方法（map/filter/forEach 等为项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);
  let collection = null;
  try {
    collection = dao.findCollectionByNameOrId('reactions');
  } catch (_) {
    collection = null;
  }
  if (!collection) {
    throw new Error('reactions collection is required before hardening its API rules');
  }

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;

  dao.saveCollection(collection);
}, (db) => {
  // 故意空操作：不回滚为匿名可读写的公开规则（理由见文件头第 2 条）。
  // 回滚路径是「恢复 pb_data 备份并重启 PocketBase」，或人工编写新的显式迁移。
});
