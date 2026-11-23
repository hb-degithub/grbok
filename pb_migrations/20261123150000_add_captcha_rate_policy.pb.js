/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 2026-11-23 ALTCHA 人机校验配套迁移（两个策略键，必须与 pb_hooks 同批上线）：
//   1. captcha_challenge_ip  —— GET /api/captcha/challenge 的 per-IP 签发配额（60/60s）
//   2. captcha_challenge_use —— 一次性 challenge 去重（防重放，1 次 / 600s）。
//      为什么要落到持久化表而不是内存 Map：PB 0.22 JSVM 每次请求都在新的 goja runtime
//      里执行，globalThis / 模块级 Map 不跨请求保留（实测），内存去重对跨请求重放无效。
//
// 为什么必须有这个迁移：security_policy_store.getRatePolicySet 要求
// security_rate_policies 的行数 === Object.keys(DEFAULTS).length，且所有行
// version 一致；只在 DEFAULTS/BOUNDS 里加键而不插行，会让**整组**策略
// fail-closed 降级（consume() 抛 RateLimitUnavailableError，评论/登录/注册/
// 管理写操作等全部 503）。因此代码与迁移必须同批上线。
//
// 结构照抄 20261116150000_add_view_rate_policy.pb.js（同一模式，生产已验证）；
// 仅用 for 循环 + 手写查重，不使用原生数组高阶方法（项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before captcha rate policy migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 300, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');
  // 迁移前置：现有行数应与"当前 DEFAULTS 键数 - 本迁移新增键数"一致。
  // 不做硬编码断言（生产版本可能已漂移），由 getRatePolicySet 的行数校验兜底。

  const defaults = {
    // [limit, windowSeconds] —— 必须与 pb_hooks/lib/security_policy_store.js 的
    // DEFAULTS / BOUNDS 完全一致。
    captcha_challenge_ip: [60, 60],   // challenge 签发：与 view_ip 同量级
    captcha_challenge_use: [1, 600],  // 一次性消耗：600s = challenge 有效期
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
  console.log('[rate-policy] inserted captcha_challenge_ip 60/60s + captcha_challenge_use 1/600s (version ' + sharedVersion + ')');
}, (db) => {
  // 回滚：删除策略行。只回滚迁移而保留 pb_hooks 里新增的 DEFAULTS/BOUNDS 键同样会让
  // 策略组行数对不上 → 全站限流 fail-closed 503，必须与 pb_hooks 改动同时回滚。
  const dao = new Dao(db);
  const keys = ['captcha_challenge_ip', 'captcha_challenge_use'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
