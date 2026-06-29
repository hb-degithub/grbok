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

  let ann = find("announcements");
  if (!ann) {
    ann = new Collection({ name: "announcements", type: "base", system: false, schema: [] });
  }
  ensureField(ann, { name: "title", type: "text", required: false, options: { min: null, max: 200, pattern: "" } });
  ensureField(ann, { name: "content", type: "text", required: true, options: { min: 1, max: 2000, pattern: "" } });
  ensureField(ann, { name: "type", type: "select", required: true, options: { maxSelect: 1, values: ["normal", "info", "warning", "important"] } });
  ensureField(ann, { name: "enabled", type: "bool", required: false });
  ensureField(ann, { name: "start_at", type: "date", required: false, options: { min: "", max: "" } });
  ensureField(ann, { name: "end_at", type: "date", required: false, options: { min: "", max: "" } });
  ann.listRule = "enabled = true && (start_at = null || start_at <= @now) && (end_at = null || end_at >= @now) || " + SUPER_ADMIN_RULE;
  ann.viewRule = "enabled = true || " + SUPER_ADMIN_RULE;
  ann.createRule = SUPER_ADMIN_RULE;
  ann.updateRule = SUPER_ADMIN_RULE;
  ann.deleteRule = SUPER_ADMIN_RULE;
  save(ann);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("announcements");
  if (col) dao.deleteCollection(col);
});
