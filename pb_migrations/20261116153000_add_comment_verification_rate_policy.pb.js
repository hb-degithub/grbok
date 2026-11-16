/// <reference path="../pb_data/types.d.ts" />

// #30 收尾（2026-11-16）：为 mail_outbox 的 comment_verification 类别注册
// 持久化限流策略键 comment_verification。
//
// 背景：pb_hooks/lib/mail_outbox.js 的 enqueue() 用**category 名**当作
// 类别级限流策略键（policyKey = category）。评论编辑/删除验证码邮件的
// category 是 comment_verification，但它此前既不在
// security_policy_store.js 的 DEFAULTS/BOUNDS，也没有对应的
// security_rate_policies 行，于是 rateLimit.consume() 在 prepareEntry()
// 里因为 policies['comment_verification'] 缺失直接抛 invalid()，
// enqueue 失败 → POST /api/comments/verification/send 恒返回
// 503 VERIFICATION_MAIL_FAILED。
//
// 为什么代码与迁移必须同批上线：security_policy_store.getRatePolicySet()
// 要求 security_rate_policies 的行数 === Object.keys(DEFAULTS).length 且
// 所有行 version 一致；只在 DEFAULTS/BOUNDS 里加键而不插行，会让**整组**
// 策略 fail-closed 降级（评论/登录/注册/管理写操作等全部 503）。
//
// 结构照抄 20261116150000_add_view_rate_policy.pb.js（同一模式，生产已验证）；
// 仅用 for 循环 + 手写查重，不使用原生数组高阶方法（项目已知陷阱）。
migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before comment verification rate policy migration');

  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  const defaults = {
    // [limit, windowSeconds] —— 必须与 pb_hooks/lib/security_policy_store.js 的
    // DEFAULTS / BOUNDS 完全一致：60 封 / 60 秒（与 comment_notification、
    // account_verification 等其它邮件类别级配额同量级）。
    comment_verification: [60, 60],
  };
  const newKeys = Object.keys(defaults);

  let sharedVersion = null;
  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    for (let n = 0; n < newKeys.length; n++) {
      if (newKeys[n] === key) throw new Error(key + ' policy already exists');
    }
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
  console.log('[rate-policy] inserted comment_verification 60/60s (version ' + sharedVersion + ')');
}, (db) => {
  // 回滚：删除策略行。只回滚迁移而保留 pb_hooks 里新增的 DEFAULTS/BOUNDS 键同样会让
  // 策略组行数对不上 → 全站限流 fail-closed 503，必须与 pb_hooks 改动同时回滚。
  const dao = new Dao(db);
  const keys = ['comment_verification'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const rows = dao.findRecordsByFilter(
        'security_rate_policies', 'key = {:key}', '', 10, 0, { key: keys[i] },
      );
      for (let j = 0; j < rows.length; j++) dao.deleteRecord(rows[j]);
    } catch (_) {}
  }
});
