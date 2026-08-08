/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// Register admin TOTP verify rate-limit policies (fail-window + lockout).
// Mirrors the comment rate migration flow: validate the existing policy set is
// consistent, then insert each new policy row with the shared version so
// getRatePolicySet() keeps returning degraded=false.
migrate((db) => {
  const dao = new Dao(db);

  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before admin totp rate migration');
  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  // Reject re-runs: any of the new keys already present means this migration
  // already applied.
  const newKeys = ['admin_totp_verify', 'admin_totp_lockout'];
  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    if (newKeys.indexOf(key) !== -1) throw new Error(key + ' policy already exists');
  }

  // All existing rows must share one version; we tag the new rows with the
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

  const defaults = {
    admin_totp_verify: [5, 300],
    admin_totp_lockout: [1, 900],
  };
  const now = new Date().toISOString();
  Object.keys(defaults).forEach((key) => {
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
  const keys = ['admin_totp_verify', 'admin_totp_lockout'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
