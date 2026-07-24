/// <reference path="../pb_local/pb/pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId('users');
  users.createRule = null;
  dao.saveCollection(users);
}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId('users');
  users.createRule = '@request.auth.role = "super_admin" || @request.data.role = "reader" || @request.data.role = ""';
  dao.saveCollection(users);
});
