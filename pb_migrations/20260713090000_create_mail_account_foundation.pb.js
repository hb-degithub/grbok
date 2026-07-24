/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const usersId = dao.findCollectionByNameOrId('users').id;

  function addField(collection, field) {
    collection.schema.addField(new SchemaField(field));
  }

  function makePrivate(collection) {
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;
  }

  const mailTemplates = new Collection({
    name: 'mail_templates',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(mailTemplates, { name: 'key', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(mailTemplates, { name: 'name', type: 'text', required: true, options: { min: 1, max: 120, pattern: '' } });
  addField(mailTemplates, { name: 'category', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(mailTemplates, { name: 'version', type: 'number', required: true, options: { min: 1, max: null, noDecimal: true } });
  addField(mailTemplates, { name: 'is_current', type: 'bool', required: true, options: {} });
  addField(mailTemplates, { name: 'subject_template', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
  addField(mailTemplates, { name: 'content_json', type: 'text', required: true, options: { min: 1, max: null, pattern: '' } });
  addField(mailTemplates, { name: 'variables_json', type: 'text', required: true, options: { min: 1, max: null, pattern: '' } });
  addField(mailTemplates, { name: 'required_variables_json', type: 'text', required: true, options: { min: 1, max: null, pattern: '' } });
  addField(mailTemplates, { name: 'builtin', type: 'bool', required: true, options: {} });
  makePrivate(mailTemplates);
  mailTemplates.indexes = [
    'CREATE UNIQUE INDEX idx_mail_templates_key_version ON mail_templates (key, version)',
    'CREATE UNIQUE INDEX idx_mail_templates_one_current ON mail_templates (key) WHERE is_current = TRUE',
  ];
  dao.saveCollection(mailTemplates);

  const deliveryLogs = new Collection({
    name: 'mail_delivery_logs',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(deliveryLogs, { name: 'request_id', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(deliveryLogs, { name: 'category', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(deliveryLogs, { name: 'source_collection', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(deliveryLogs, { name: 'source_record_id', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(deliveryLogs, { name: 'recipient_masked', type: 'text', required: true, options: { min: 1, max: 320, pattern: '' } });
  addField(deliveryLogs, { name: 'recipient_hash', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(deliveryLogs, { name: 'request_ip_hash', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(deliveryLogs, {
    name: 'result',
    type: 'select',
    required: true,
    options: {
      maxSelect: 1,
      values: ['accepted', 'sent', 'failed', 'suppressed', 'rate_limited', 'decoy'],
    },
  });
  addField(deliveryLogs, { name: 'duration_ms', type: 'number', required: true, options: { min: 0, max: null, noDecimal: true } });
  addField(deliveryLogs, { name: 'attempt', type: 'number', required: true, options: { min: 0, max: null, noDecimal: true } });
  addField(deliveryLogs, { name: 'error_class', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  makePrivate(deliveryLogs);
  deliveryLogs.indexes = [
    'CREATE UNIQUE INDEX idx_mail_delivery_logs_request_id ON mail_delivery_logs (request_id)',
    'CREATE INDEX idx_mail_delivery_logs_created_category ON mail_delivery_logs (created, category)',
    'CREATE INDEX idx_mail_delivery_logs_recipient_hash ON mail_delivery_logs (recipient_hash, created)',
  ];
  dao.saveCollection(deliveryLogs);

  const otpChallenges = new Collection({
    name: 'auth_otp_challenges',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(otpChallenges, { name: 'challenge_id', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(otpChallenges, {
    name: 'user',
    type: 'relation',
    required: false,
    options: {
      collectionId: usersId,
      cascadeDelete: true,
      minSelect: null,
      maxSelect: 1,
      displayFields: ['name', 'email'],
    },
  });
  addField(otpChallenges, { name: 'email_hash', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(otpChallenges, { name: 'ip_hash', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(otpChallenges, { name: 'code_hash', type: 'text', required: true, options: { min: 1, max: 255, pattern: '' } });
  addField(otpChallenges, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(otpChallenges, { name: 'attempts', type: 'number', required: true, options: { min: 0, max: null, noDecimal: true } });
  addField(otpChallenges, { name: 'consumed_at', type: 'date', required: false, options: { min: '', max: '' } });
  makePrivate(otpChallenges);
  otpChallenges.indexes = [
    'CREATE UNIQUE INDEX idx_auth_otp_challenge_id ON auth_otp_challenges (challenge_id)',
    'CREATE INDEX idx_auth_otp_email_created ON auth_otp_challenges (email_hash, created)',
    'CREATE INDEX idx_auth_otp_ip_created ON auth_otp_challenges (ip_hash, created)',
    'CREATE INDEX idx_auth_otp_user_active ON auth_otp_challenges (user, consumed_at, expires_at)',
  ];
  dao.saveCollection(otpChallenges);

  const seeds = [
    ['account_verification', '验证邮箱', 'account_verification', '验证你的邮箱', ['displayName', 'actionUrl', 'expiresMinutes'], ['displayName', 'actionUrl']],
    ['account_password_reset', '重置密码', 'account_password_reset', '重置你的密码', ['displayName', 'actionUrl', 'expiresMinutes'], ['displayName', 'actionUrl']],
    ['account_email_change', '确认新邮箱', 'account_email_change', '确认修改邮箱', ['displayName', 'newEmailMasked', 'actionUrl', 'expiresMinutes'], ['displayName', 'newEmailMasked', 'actionUrl']],
    ['reader_otp', '读者登录验证码', 'reader_otp', '你的登录验证码', ['displayName', 'code', 'expiresMinutes'], ['displayName', 'code']],
  ];

  const savedTemplates = dao.findCollectionByNameOrId('mail_templates');
  for (const seed of seeds) {
    const [key, name, category, subject, variables, requiredVariables] = seed;
    const content = {
      preheader: '{{subject}}',
      title: '{{subject}}',
      paragraphs: [
        '你好，{{displayName}}。',
        '请使用下方按钮或验证码完成操作；若非本人操作，请忽略此邮件。',
      ],
      action: { label: '继续', urlVariable: 'actionUrl' },
      footer: '此邮件由 hlydwz.com 自动发送，请勿回复。',
    };
    if (key === 'reader_otp') {
      content.paragraphs = ['你好，{{displayName}}。', '你的验证码是 {{code}}，10 分钟内有效。'];
      content.action = null;
    }

    const record = new Record(savedTemplates);
    record.set('key', key);
    record.set('name', name);
    record.set('category', category);
    record.set('version', 1);
    record.set('is_current', true);
    record.set('subject_template', subject);
    record.set('content_json', JSON.stringify(content));
    record.set('variables_json', JSON.stringify(variables));
    record.set('required_variables_json', JSON.stringify(requiredVariables));
    record.set('builtin', true);
    dao.saveRecord(record);
  }
}, (db) => {
  const dao = new Dao(db);
  for (const name of ['auth_otp_challenges', 'mail_delivery_logs', 'mail_templates']) {
    try {
      dao.deleteCollection(dao.findCollectionByNameOrId(name));
    } catch (_) {}
  }
});
