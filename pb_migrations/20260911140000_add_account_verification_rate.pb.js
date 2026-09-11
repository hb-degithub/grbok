/// <reference path="../pb_data/types.d.ts" />

// 补种 account_verification 限流策略。
//
// 背景：mail_outbox.enqueue 按 category 名消耗限流（policyKey='account_verification'），
// 但 security_rate_policies 表从未注册该 key（现有的是 account_mail_email/ip/global），
// prepareEntry 查不到策略抛 invalid('invalid rate limit input')，导致注册后的验证
// 邮件从未成功入队（日志：[account-mail] verification-enqueue result=invalid rate limit input）。
//
// 阈值对齐同类全局桶 comment_notification(60/60)；验证邮件的按邮箱/IP 维度限流
// 已在 registration_facade.requestInitialVerification 的 account_mail_* 三轴承担，
// 此处仅为 category 级全局配额（防 worker 风暴）。
//
// 注意：版本号与现有策略集保持一致（version=1），避免 getRatePolicySet 版本不一致
// 触发降级。幂等：已存在则跳过。

migrate((db) => {
  const dao = new Dao(db);
  const policyCollection = dao.findCollectionByNameOrId('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required');

  let existing = null;
  try {
    existing = dao.findFirstRecordByFilter('security_rate_policies', 'key = {:key}', { key: 'account_verification' });
  } catch (_) {
    existing = null;
  }
  if (existing) return;

  // 沿用策略集的共享版本号（全部现存行 version 一致，见 store/migration 约定）
  let sharedVersion = 1;
  try {
    const anyRow = dao.findFirstRecordByFilter('security_rate_policies', 'id != ""', '');
    if (anyRow) sharedVersion = Number(anyRow.get('version')) || 1;
  } catch (_) {}

  const record = new Record(policyCollection);
  record.set('key', 'account_verification');
  record.set('limit', 60);
  record.set('window_seconds', 60);
  record.set('version', sharedVersion);
  record.set('updated_by', 'migration');
  record.set('updated_at', new Date().toISOString());
  dao.saveRecord(record);
}, (db) => {
  const dao = new Dao(db);
  try {
    const record = dao.findFirstRecordByFilter('security_rate_policies', 'key = {:key}', { key: 'account_verification' });
    if (record) dao.deleteRecord(record);
  } catch (_) {}
});
