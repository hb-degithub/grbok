/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const usersId = dao.findCollectionByNameOrId('users').id;

  let existing = null;
  try { existing = dao.findCollectionByNameOrId('admin_totp_secrets'); } catch (_) {}
  if (existing) return; // 幂等：已存在则跳过

  const collection = new Collection({
    name: 'admin_totp_secrets',
    type: 'base',
    system: false,
    schema: [],
  });

  function addField(field) {
    collection.schema.addField(new SchemaField(field));
  }

  addField({ name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  // setup 阶段暂存的待确认 secret（encryptSecret 输出：v1.<nonce>.<cipher>.<tag>）
  addField({ name: 'secret_pending_enc', type: 'text', required: false, options: { min: null, max: 2048, pattern: '' } });
  // confirm 后的正式 secret（同格式）
  addField({ name: 'secret_enc', type: 'text', required: false, options: { min: null, max: 2048, pattern: '' } });
  // 绑定完成时间；空 = 未绑定
  addField({ name: 'confirmed_at', type: 'date', required: false, options: { min: '', max: '' } });
  // 防重放水线：已使用的最大 timestep
  addField({ name: 'last_used_timestep', type: 'number', required: false, options: { min: -1, max: null } });
  addField({ name: 'revoked_at', type: 'date', required: false, options: { min: '', max: '' } });
  // 恢复码 HMAC（沿用现有 local-recovery 机制）
  addField({ name: 'recovery_nonce_hmac', type: 'text', required: false, options: { min: null, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField({ name: 'recovery_expires_at', type: 'date', required: false, options: { min: '', max: '' } });

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  collection.indexes = [
    'CREATE UNIQUE INDEX idx_admin_totp_secrets_user ON admin_totp_secrets (user)',
  ];

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    const collection = dao.findCollectionByNameOrId('admin_totp_secrets');
    dao.deleteCollection(collection);
  } catch (_) {}
});
