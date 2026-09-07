/// <reference path="../pb_data/types.d.ts" />

// 文章点赞/收藏：
// 1) posts 表补充 likes 数字字段（如不存在）。
// 2) 新建服务端私有 post_likes / post_bookmarks 集合，
//    visitor_hash 是 MAIL_HASH_SECRET HMAC，不保存原始 IP/User-Agent；
//    post + visitor_hash 唯一索引同时保证幂等和并发安全。
// 3) 注册 post_like_ip / post_bookmark_ip 限流策略，
//    与既有策略保持同一 version，确保 getRatePolicySet() 不降级。
// 注意：PocketBase 迁移脚本避免依赖原生数组高阶方法（用 for 循环）。

migrate((db) => {
  const dao = new Dao(db);

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const posts = dao.findCollectionByNameOrId('posts');
  if (!posts) throw new Error('posts collection is required');

  // 1) posts.likes 字段（幂等：已存在则保留原 id）
  ensureField(posts, { name: 'likes', type: 'number', required: false, options: { min: 0, max: null, noDecimal: true } });
  dao.saveCollection(posts);

  // 2) post_likes / post_bookmarks 集合
  function ensureActionCollection(name) {
    let collection;
    try {
      collection = dao.findCollectionByNameOrId(name);
    } catch (_) {
      collection = new Collection({
        name: name,
        type: 'base',
        system: false,
        schema: [],
      });
    }

    ensureField(collection, {
      name: 'post',
      type: 'relation',
      required: true,
      options: {
        collectionId: posts.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1,
        displayFields: ['title'],
      },
    });
    ensureField(collection, {
      name: 'visitor_hash',
      type: 'text',
      required: true,
      options: { min: 32, max: 256, pattern: '' },
    });

    // 只允许服务端 hooks 通过 DAO 访问，公共 REST API 完全关闭。
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;

    const indexName = 'idx_' + name + '_unique';
    const uniqueIndex = 'CREATE UNIQUE INDEX IF NOT EXISTS ' + indexName + ' ON ' + name + ' (post, visitor_hash)';
    const indexes = collection.indexes || [];
    let hasUniqueIndex = false;
    for (let i = 0; i < indexes.length; i++) {
      if (String(indexes[i]).indexOf(indexName) !== -1) {
        hasUniqueIndex = true;
        break;
      }
    }
    if (!hasUniqueIndex) indexes[indexes.length] = uniqueIndex;
    collection.indexes = indexes;

    dao.saveCollection(collection);
  }

  ensureActionCollection('post_likes');
  ensureActionCollection('post_bookmarks');

  // 3) 注册限流策略（复用 add_comment_action_rate_policies 的版本一致性校验流程）
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before post action rate migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const newKeys = ['post_like_ip', 'post_bookmark_ip'];
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

  const defaults = {
    post_like_ip: [10, 60],
    post_bookmark_ip: [10, 60],
  };
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

  const names = ['post_likes', 'post_bookmarks'];
  for (let i = 0; i < names.length; i++) {
    try {
      const collection = dao.findCollectionByNameOrId(names[i]);
      dao.deleteCollection(collection);
    } catch (_) {}
  }

  const keys = ['post_like_ip', 'post_bookmark_ip'];
  for (let j = 0; j < keys.length; j++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[j] },
      );
      for (let n = 0; n < rows.length; n++) dao.deleteRecord(rows[n]);
    } catch (_) {}
  }

  // 注意：posts.likes 字段不删除，避免误删既有数据；
  // 如需移除请单独写迁移并人工确认。
});
