/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// Register comment reply notification rate-limit policy.
// Follows the same pattern as the comment rate policies migration.
migrate((db) => {
  const dao = new Dao(db);

  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before comment reply notification rate migration');
  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  // Reject re-runs: if the new key already present means this migration already applied.
  const newKey = 'comment_reply_notification';
  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    if (key === newKey) throw new Error(newKey + ' policy already exists');
  }

  // All existing rows must share one version; we tag the new row with the
  // same value so getRatePolicySet() still sees a single coherent version.
  let sharedVersion = null;
  for (let i = 0; i < policyRows.length; i++) {
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
  const record = new Record(policyCollection);
  record.set('key', newKey);
  record.set('limit', 60);
  record.set('window_seconds', 60);
  record.set('version', sharedVersion);
  record.set('updated_by', 'migration');
  record.set('updated_at', now);
  dao.saveRecord(record);
}, (db) => {
  const dao = new Dao(db);
  try {
    const rows = dao.findRecordsByFilter(
      'security_rate_policies', 'key = {:key}', '', 10, 0, { key: 'comment_reply_notification' },
    );
    for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
  } catch (_) {}
});
