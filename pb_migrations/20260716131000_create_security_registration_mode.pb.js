/// <reference path="../pb_local/pb/pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = new Collection({
    name: 'security_registration_mode', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    schema: [
      new SchemaField({ name: 'mode', type: 'select', required: true, options: { maxSelect: 1, values: ['open', 'invite_only'] } }),
      new SchemaField({ name: 'version', type: 'number', required: true, options: { min: 1, max: 2147483647, noDecimal: true } }),
      new SchemaField({ name: 'updated_by', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } }),
      new SchemaField({ name: 'updated_at', type: 'date', required: true, options: { min: '', max: '' } }),
    ],
  });
  dao.saveCollection(collection);
  let mode = 'open';
  let version = 1;
  try {
    const legacy = dao.findFirstRecordByData('settings', 'key', 'security_registration_mode');
    let value = legacy.get('value');
    if (typeof value === 'string') value = JSON.parse(value);
    if (value && (value.mode === 'open' || value.mode === 'invite_only') && Number.isSafeInteger(Number(value.version)) && Number(value.version) >= 1) {
      mode = value.mode; version = Number(value.version);
    }
  } catch (_) {}
  const record = new Record(dao.findCollectionByNameOrId('security_registration_mode'));
  record.set('mode', mode); record.set('version', version); record.set('updated_by', 'migration'); record.set('updated_at', new Date().toISOString());
  dao.saveRecord(record);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('security_registration_mode')); } catch (_) {}
});
