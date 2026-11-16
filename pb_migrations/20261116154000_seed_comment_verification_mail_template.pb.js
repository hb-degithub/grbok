/// <reference path="../pb_data/types.d.ts" />

// #30 收尾（2026-11-16）：种一条 comment_verification 邮件模板。
//
// 背景：pb_hooks/lib/comment_verification.js 在发送评论编辑/删除验证码时，会通过
// mail_outbox.enqueue() 入队（category=comment_verification、templateKey=
// comment_verification、variables={code}）。但 20260713090000_create_mail_account_
// foundation.pb.js 只种了 account_verification / account_password_reset /
// account_email_change / reader_otp 四行模板，mail_outbox 的 render() 对
// comment_verification 没有模板行可取 → 发信阶段必然失败。
//
// 本迁移只做一件事：插入一行 is_current 的 comment_verification 模板，
// 字段与既有模板完全一致（subject_template / content_json / variables_json /
// required_variables_json / builtin），风格参考 account_verification：
//   - subject：验证码邮件，纯文本主题（正文里用 {{subject}} 复用）；
//   - content_json：preheader/title/paragraphs/footer，无 actionUrl 按钮
//     （验证码邮件不需要跳转链接，避免再引入一类可注入的 URL 变量）；
//   - 正文含 6 位 {{code}} 占位与「10 分钟内有效」文案；
//   - variables/required_variables 只声明 code —— 与 mail_outbox.render() 传参一致。
//
// 幂等：key=comment_verification 已有 is_current 行时直接跳过，不重复插入
// （mail_templates 上有 idx_mail_templates_one_current 唯一索引兜底）。
migrate((db) => {
  const dao = new Dao(db);
  const templates = dao.findCollectionByNameOrId('mail_templates');
  if (!templates) throw new Error('mail_templates collection is required');

  const existing = dao.findRecordsByFilter(
    'mail_templates', 'key = {:key} && is_current = true', '-created', 1, 0, { key: 'comment_verification' },
  );
  if (existing && existing.length) {
    console.log('[mail-template] comment_verification already present, skip');
    return;
  }

  const content = {
    preheader: '{{subject}}',
    title: '{{subject}}',
    paragraphs: [
      '你好，',
      '你的评论操作验证码是 {{code}}，10 分钟内有效。',
      '请勿把验证码告诉任何人；若非本人操作，请忽略此邮件。',
    ],
    // 验证码邮件不需要 actionUrl：正文只给 6 位数字，避免额外的 URL 变量面。
    action: null,
    footer: '此邮件由 hlydwz.com 自动发送，请勿回复。',
  };

  const record = new Record(templates);
  record.set('key', 'comment_verification');
  record.set('name', '评论操作验证码');
  record.set('category', 'comment_verification');
  record.set('version', 1);
  record.set('is_current', true);
  record.set('subject_template', '你的评论操作验证码');
  record.set('content_json', JSON.stringify(content));
  record.set('variables_json', JSON.stringify(['code']));
  record.set('required_variables_json', JSON.stringify(['code']));
  record.set('builtin', true);
  dao.saveRecord(record);
  console.log('[mail-template] seeded comment_verification (v1, current)');
}, (db) => {
  // 回滚：删除本迁移种下的那一行（只按 key+version=1 精确定位，不动后台改版后的其它版本）。
  const dao = new Dao(db);
  try {
    const rows = dao.findRecordsByFilter(
      'mail_templates', 'key = {:key} && version = 1', '', 10, 0, { key: 'comment_verification' },
    );
    for (let i = 0; i < rows.length; i++) dao.deleteRecord(rows[i]);
  } catch (_) {}
});
