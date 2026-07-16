/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  batches.schema.addField(new SchemaField({
    name: 'age_recipient_fingerprints',
    type: 'json',
    required: false,
    options: { maxSize: 256 },
  }));
  dao.saveCollection(batches);
}, (db) => {
  const dao = new Dao(db);
  const batches = dao.findCollectionByNameOrId('mail_archive_batches');
  try {
    const field = batches.schema.getFieldByName('age_recipient_fingerprints');
    batches.schema.removeField(field.id);
    dao.saveCollection(batches);
  } catch (_) {}
});
