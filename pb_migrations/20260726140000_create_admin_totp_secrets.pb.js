/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  // 如果集合已存在则跳过
  try {
    dao.findCollectionByNameOrId('admin_totp_secrets');
    return; // 已存在，无需创建
  } catch (_) {}

  const usersId = dao.findCollectionByNameOrId('users').id;

  function addField(collection, field) {
    collection.schema.addField(new SchemaField(field));
  }

  const collection = new Collection({
    name: 'admin_totp_secrets',
    type: 'base',
    system: false,
    schema: [],
  });

  addField(collection, { name: 'user', type: 'relation', required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1 } });
  addField(collection, { name: 'secret_pending_enc', type: 'text', required: false, options: { min: null, max: null, pattern: '' } });
  addField(collection, { name: 'secret_enc', type: 'text', required: false, options: { min: null, max: null, pattern: '' } });
  addField(collection, { name: 'confirmed_at', type: 'date', required: false, options: { min: '', max: '' } });
  addField(collection, { name: 'last_used_timestep', type: 'number', required: false, options: { min: null, max: null, noDecimal: true } });
  addField(collection, { name: 'revoked_at', type: 'date', required: false, options: { min: '', max: '' } });
  addField(collection, { name: 'recovery_nonce_hmac', type: 'text', required: false, options: { min: null, max: null, pattern: '' } });
  addField(collection, { name: 'recovery_expires_at', type: 'date', required: false, options: { min: '', max: '' } });

  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;

  collection.indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_totp_secrets_user ON admin_totp_secrets (user)',
  ];

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('admin_totp_secrets'));
  } catch (_) {}
});
