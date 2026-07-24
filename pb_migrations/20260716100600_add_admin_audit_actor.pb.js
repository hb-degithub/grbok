/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const audits = dao.findCollectionByNameOrId('admin_security_audits');
  const pageSize = 100;

  audits.schema.addField(new SchemaField({
    name: 'actor_type',
    type: 'select',
    required: false,
    options: { values: ['user', 'pb_admin', 'system'], maxSelect: 1 },
  }));
  audits.schema.addField(new SchemaField({
    name: 'actor_reference',
    type: 'text',
    required: false,
    options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' },
  }));
  audits.indexes = (audits.indexes || []).concat([
    'CREATE INDEX idx_admin_security_audits_actor_type ON admin_security_audits (actor_type, actor_reference, created)',
  ]);
  dao.saveCollection(audits);

  let offset = 0;
  while (true) {
    const page = dao.findRecordsByFilter('admin_security_audits', 'id != ""', '+id', pageSize, offset);
    if (!page.length) break;
    for (const record of page) {
      record.set('actor_type', record.getString('actor') ? 'user' : 'system');
      dao.saveRecord(record);
    }
    offset += page.length;
  }

  const actorType = audits.schema.getFieldByName('actor_type');
  audits.schema.addField(new SchemaField({
    id: actorType.id,
    name: 'actor_type',
    type: 'select',
    required: true,
    options: { values: ['user', 'pb_admin', 'system'], maxSelect: 1 },
  }));
  dao.saveCollection(audits);
}, (db) => {
  const dao = new Dao(db);
  const audits = dao.findCollectionByNameOrId('admin_security_audits');
  audits.indexes = (audits.indexes || []).filter((value) => value.indexOf('idx_admin_security_audits_actor_type') === -1);
  for (const name of ['actor_type', 'actor_reference']) {
    try {
      const field = audits.schema.getFieldByName(name);
      audits.schema.removeField(field.id);
    } catch (_) {}
  }
  dao.saveCollection(audits);
});
