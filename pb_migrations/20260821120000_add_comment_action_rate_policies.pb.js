/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// Register the comment action policies already required by the runtime store.
// Keeping every persisted row on one shared version prevents policy reads from
// falling back to the degraded in-memory defaults.
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before comment action rate migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    comment_like_ip: [10, 60],
    comment_edit_ip: [5, 300],
    comment_delete_ip: [3, 300],
    comment_verification_email: [1, 60],
    comment_verification_ip: [5, 60],
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
    'comment_like_ip',
    'comment_edit_ip',
    'comment_delete_ip',
    'comment_verification_email',
    'comment_verification_ip',
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
