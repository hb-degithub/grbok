/// <reference path="../pb_local/pb/pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_outbox');
  if (!collection.schema.getFieldByName('lease_token')) collection.schema.addField(new SchemaField({ name: 'lease_token', type: 'text', required: false, options: { min: 0, max: 64, pattern: '^[A-Za-z0-9_-]*$' } }));
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_outbox');
  const field = collection.schema.getFieldByName('lease_token');
  if (field) collection.schema.removeField(field.id);
  dao.saveCollection(collection);
});
