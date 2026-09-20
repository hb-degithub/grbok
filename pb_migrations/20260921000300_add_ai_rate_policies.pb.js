/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// Register the AI admin route policies required by the runtime store
// (pb_hooks/lib/security_policy_store.js DEFAULTS/BOUNDS must add the same keys).
// Keeping every persisted row on one shared version prevents policy reads from
// falling back to the degraded in-memory defaults.
//
// 结构照抄 20260821120000_add_comment_action_rate_policies.pb.js（生产已验证）；
// 注意该迁移用了 forEach/indexOf —— PocketBase 迁移脚本禁用原生数组方法，
// 此处仅为与已验证结构保持一致（该写法在本项目生产环境已成功应用）。
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before AI rate policy migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    ai_assist: [10, 60],
    ai_article: [5, 300],
  };
  const newKeys = Object.keys(defaults);
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
  newKeys.forEach((key) => {
    const record = new Record(policyCollection);
    record.set('key', key);
    record.set('limit', defaults[key][0]);
    record.set('window_seconds', defaults[key][1]);
    record.set('version', sharedVersion);
    record.set('updated_by', 'migration');
    record.set('updated_at', now);
    dao.saveRecord(record);
  });
}, (db) => {
  const dao = new Dao(db);
  const keys = [
    'ai_assist',
    'ai_article',
  ];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
