migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  const SUPER_ADMIN_RULE = '@request.auth.role = "super_admin"';
  const AUTHOR_RULE = '@request.auth.role = "author" || ' + ADMIN_RULE;

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function save(collection) {
    dao.saveCollection(collection);
    return dao.findCollectionByNameOrId(collection.name);
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  let pv = find("post_versions");
  if (!pv) {
    pv = new Collection({ name: "post_versions", type: "base", system: false, schema: [] });
  }
  if (find("posts")) ensureField(pv, { name: "post_id", type: "relation", required: true, options: { collectionId: find("posts").id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ["title"] } });
  ensureField(pv, { name: "title", type: "text", required: false, options: { min: null, max: 160, pattern: "" } });
  ensureField(pv, { name: "excerpt", type: "text", required: false, options: { min: null, max: 500, pattern: "" } });
  ensureField(pv, { name: "content", type: "editor", required: false, options: { convertUrls: false } });
  if (find("users")) ensureField(pv, { name: "editor", type: "relation", required: false, options: { collectionId: find("users").id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ["name"] } });
  pv.listRule = ADMIN_RULE;
  pv.viewRule = ADMIN_RULE;
  pv.createRule = AUTHOR_RULE;
  pv.updateRule = null;
  pv.deleteRule = SUPER_ADMIN_RULE;
  save(pv);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("post_versions");
  if (col) dao.deleteCollection(col);
});
