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

  let cr = find("comment_reports");
  if (!cr) {
    cr = new Collection({ name: "comment_reports", type: "base", system: false, schema: [] });
  }
  const comments = find("comments");
  if (comments) ensureField(cr, { name: "comment_id", type: "relation", required: true, options: { collectionId: comments.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ["author_name"] } });
  ensureField(cr, { name: "reason", type: "text", required: false, options: { min: null, max: 500, pattern: "" } });
  ensureField(cr, { name: "reporter_email", type: "text", required: false, options: { min: null, max: 255, pattern: "" } });
  ensureField(cr, { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["pending", "dismissed", "actioned"] } });
  cr.listRule = ADMIN_RULE;
  cr.viewRule = ADMIN_RULE;
  cr.createRule = "";
  cr.updateRule = ADMIN_RULE;
  cr.deleteRule = SUPER_ADMIN_RULE;
  save(cr);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("comment_reports");
  if (col) dao.deleteCollection(col);
});
