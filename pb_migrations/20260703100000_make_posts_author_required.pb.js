/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("posts");

  // Make the author field required to prevent posts without an author
  const authorField = collection.schema.getFieldByName("author");
  if (authorField) {
    authorField.required = true;
  }
  dao.saveCollection(collection);

}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("posts");

  // Rollback: set author back to optional
  const authorField = collection.schema.getFieldByName("author");
  if (authorField) {
    authorField.required = false;
  }
  dao.saveCollection(collection);
});
