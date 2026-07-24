/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const policyCollection = find('security_rate_policies');
  if (!policyCollection) throw new Error('security_rate_policies is required before guestbook migration');
  const policyRows = dao.findRecordsByFilter('security_rate_policies', 'id != ""', 'key', 200, 0);
  if (!policyRows.length) throw new Error('security rate policy set is empty');

  let sharedVersion = null;
  for (let i = 0; i < policyRows.length; i++) {
    const key = String(policyRows[i].get('key') || '');
    const rowVersion = Number(policyRows[i].get('version'));
    if (key === 'guestbook_ip') throw new Error('guestbook_ip policy already exists');
    if (!Number.isSafeInteger(rowVersion) || rowVersion < 1) {
      throw new Error('security rate policy version is invalid');
    }
    if (sharedVersion !== null && sharedVersion !== rowVersion) {
      throw new Error('security rate policy versions are inconsistent');
    }
    sharedVersion = rowVersion;
  }
  if (sharedVersion === null) throw new Error('security rate policy version is unavailable');

  if (find('guestbook_messages')) throw new Error('guestbook_messages collection already exists');
  const messages = new Collection({
    name: 'guestbook_messages',
    type: 'base',
    system: false,
    schema: [],
  });
  messages.listRule = 'status = "show"';
  messages.viewRule = 'status = "show"';
  messages.createRule = '';
  messages.updateRule = '@request.auth.role = "super_admin"';
  messages.deleteRule = '@request.auth.role = "super_admin"';
  ensureField(messages, { name: 'nickname', type: 'text', required: true, options: { min: 1, max: 30, pattern: '' } });
  ensureField(messages, { name: 'content', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
  ensureField(messages, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['show', 'hidden'] } });
  dao.saveCollection(messages);

  const policy = new Record(policyCollection);
  policy.set('key', 'guestbook_ip');
  policy.set('limit', 5);
  policy.set('window_seconds', 3600);
  policy.set('version', sharedVersion);
  policy.set('updated_by', 'migration');
  policy.set('updated_at', new Date().toISOString());
  dao.saveRecord(policy);
}, (db) => {
  const dao = new Dao(db);
  try {
    const rows = dao.findRecordsByFilter(
      'security_rate_policies', 'key = {:key}', '', 10, 0, { key: 'guestbook_ip' },
    );
    for (let i = 0; i < rows.length; i++) dao.deleteRecord(rows[i]);
  } catch (_) {}
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('guestbook_messages'));
  } catch (_) {}
});
