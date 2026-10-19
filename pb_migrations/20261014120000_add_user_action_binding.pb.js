/// <reference path="../pb_data/types.d.ts" />

// 2026-10-14 渗透测试 #3 加固：点赞/收藏去重键绑定「已认证用户身份」。
//
// 本迁移只做两件事（都是新增，不改写任何已应用迁移）：
//   1) 给 post_likes / post_bookmarks / comment_likes 三个服务端私有集合
//      补一个可空的 user 关系字段 + 索引，为「同一用户对同一目标只允许一行」
//      提供数据库级约束（visitor_hash 唯一索引继续保留，历史行不受影响）。
//   2) 注册用户维度限流策略 post_like_user / post_bookmark_user /
//      comment_like_user（30 / 60s、30 / 60s、60 / 60s）。
//
// ⚠️ 部署强绑定：security_policy_store.js 的 DEFAULTS + BOUNDS **必须**同步
//    加入完全相同的三个键与阈值，否则 getRatePolicySet() 会因
//    `records.length !== Object.keys(DEFAULTS).length` 判定整体降级
//    （degraded=true），届时全站所有限流接口都会 503。
//    两侧必须同一次发布上线：本迁移文件不可单独部署。
//
// 注意：PocketBase 迁移脚本避免依赖原生数组高阶方法（用 for 循环）。

migrate((db) => {
  const dao = new Dao(db);

  const users = dao.findCollectionByNameOrId('users');
  if (!users) throw new Error('users collection is required before action user binding');

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  function ensureIndex(collection, indexName, ddl) {
    const indexes = collection.indexes || [];
    for (let i = 0; i < indexes.length; i++) {
      if (String(indexes[i]).indexOf(indexName) !== -1) return;
    }
    indexes[indexes.length] = ddl;
    collection.indexes = indexes;
  }

  const actionCollections = ['post_likes', 'post_bookmarks', 'comment_likes'];
  for (let c = 0; c < actionCollections.length; c++) {
    const name = actionCollections[c];
    let collection;
    try {
      collection = dao.findCollectionByNameOrId(name);
    } catch (_) {
      continue; // 集合不存在（例如只跑了部分迁移）→ 跳过，不阻断
    }

    // 可空关系：历史 IP 绑定行保持 user 为空，不影响既有唯一索引。
    ensureField(collection, {
      name: 'user',
      type: 'relation',
      required: false,
      options: {
        collectionId: users.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1,
        displayFields: ['email'],
      },
    });

    ensureIndex(
      collection,
      'idx_' + name + '_user',
      'CREATE INDEX IF NOT EXISTS idx_' + name + '_user ON ' + name + ' (user)',
    );

    // 服务端私有集合：继续完全关闭公共 REST 访问。
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;

    dao.saveCollection(collection);
  }

  // 2) 注册用户维度限流策略（与既有策略保持同一 version）。
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before user action rate migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    post_like_user: [30, 60],
    post_bookmark_user: [30, 60],
    comment_like_user: [60, 60],
  };
  const newKeys = ['post_like_user', 'post_bookmark_user', 'comment_like_user'];
  let sharedVersion = null;

  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    if (newKeys.indexOf(key) !== -1) throw new Error(key + ' policy already exists');

    const rowVersion = Number(policyRows[i].get('version'));
    if (!Number.isSafeInteger(rowVersion) || rowVersion < 1) {
      throw new Error('security rate policy version is invalid');
    }
    if (sharedVersion !== null && sharedVersion !== rowVersion) {
      throw new Error('security rate policy versions are inconsistent');
    }
    sharedVersion = rowVersion;
  }
  if (sharedVersion === null) throw new Error('security rate policy version is unavailable');

  const now = new Date().toISOString();
  for (let k = 0; k < newKeys.length; k++) {
    const key = newKeys[k];
    const record = new Record(policyCollection);
    record.set('key', key);
    record.set('limit', defaults[key][0]);
    record.set('window_seconds', defaults[key][1]);
    record.set('version', sharedVersion);
    record.set('updated_by', 'migration');
    record.set('updated_at', now);
    dao.saveRecord(record);
  }
}, (db) => {
  const dao = new Dao(db);

  // down：移除策略行，user 字段与索引保留（避免误删历史数据，
  // 如需彻底回退请单独写迁移并人工确认）。
  const keys = ['post_like_user', 'post_bookmark_user', 'comment_like_user'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
