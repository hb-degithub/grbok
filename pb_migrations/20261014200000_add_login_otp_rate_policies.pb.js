/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 2026-10-14 渗透测试 #5 / #7 配套迁移：
// 把密码登录限流（login_security_lib.js）与读者 OTP 校验限流（auth_otp.js）
// 所需的 4 个策略键注册进 security_rate_policies。
//
// 为什么必须有这个迁移：security_policy_store.getRatePolicySet 要求
// security_rate_policies 的行数 === Object.keys(DEFAULTS).length，且所有行 version 一致；
// 只在 DEFAULTS/BOUNDS 里加键而不插行，会让**整组**策略 fail-closed 降级
// （consume() 抛 RateLimitUnavailableError）。
//
// 结构照抄 20260921000300_add_ai_rate_policies.pb.js（生产已验证）；
// 仅用 for 循环 + 手写查重，不使用原生数组方法（项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before login/otp rate policy migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    // [limit, windowSeconds] —— 必须与 pb_hooks/lib/security_policy_store.js 的 DEFAULTS 一致
    login_ip: [10, 900],
    login_email_ip: [5, 900],
    login_email_any: [30, 900],
    otp_verify_ip: [20, 600],
  };
  const newKeys = Object.keys(defaults);

  let sharedVersion = null;
  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    let isNewKey = false;
    for (let n = 0; n < newKeys.length; n++) {
      if (newKeys[n] === key) isNewKey = true;
    }
    if (isNewKey) throw new Error(key + ' policy already exists');

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
    const record = new Record(policyCollection);
    record.set('key', newKeys[k]);
    record.set('limit', defaults[newKeys[k]][0]);
    record.set('window_seconds', defaults[newKeys[k]][1]);
    record.set('version', sharedVersion);
    record.set('updated_by', 'migration');
    record.set('updated_at', now);
    dao.saveRecord(record);
  }
}, (db) => {
  const dao = new Dao(db);
  const keys = ['login_ip', 'login_email_ip', 'login_email_any', 'otp_verify_ip'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
