/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 2026-11-16 渗透测试 #24 配套迁移：
// 为匿名 /api/track-view 的持久化限流注册 view_ip 策略键。
//
// 为什么必须有这个迁移：security_policy_store.getRatePolicySet 要求
// security_rate_policies 的行数 === Object.keys(DEFAULTS).length，且所有行
// version 一致；只在 DEFAULTS/BOUNDS 里加键而不插行，会让**整组**策略
// fail-closed 降级（consume() 抛 RateLimitUnavailableError，评论/登录/注册/
// 管理写操作等全部 503）。因此代码与迁移必须同批上线。
//
// 结构照抄 20261014200000_add_login_otp_rate_policies.pb.js（生产已验证）；
// 仅用 for 循环 + 手写查重，不使用原生数组方法（项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before view rate policy migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    // [limit, windowSeconds] —— 必须与 pb_hooks/lib/security_policy_store.js 的
    // DEFAULTS / BOUNDS 一致：60 次 / 60 秒（沿用旧内存桶的每 IP 阈值）。
    view_ip: [60, 60],
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
  // 回滚：删除策略行。代码回滚到不含 view_ip 的版本后行数才会重新对齐；
  // 只回滚迁移而保留新代码同样会让策略组降级，必须同时回滚 pb_hooks 改动。
  const dao = new Dao(db);
  const keys = ['view_ip'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
