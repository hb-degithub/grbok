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

  let links = find("friend_links");
  if (!links) {
    links = new Collection({ name: "friend_links", type: "base", system: false, schema: [] });
  }
  ensureField(links, { name: "name", type: "text", required: true, options: { min: 1, max: 100, pattern: "" } });
  ensureField(links, { name: "url", type: "text", required: true, options: { min: 1, max: 500, pattern: "" } });
  ensureField(links, { name: "description", type: "text", required: false, options: { min: null, max: 500, pattern: "" } });
  ensureField(links, { name: "avatar", type: "text", required: false, options: { min: null, max: 500, pattern: "" } });
  ensureField(links, { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["show", "hide"] } });
  ensureField(links, { name: "sort_order", type: "number", required: false, options: { min: 0, max: null, noDecimal: true } });
  links.listRule = "status = \"show\" || " + AUTHOR_RULE;
  links.viewRule = "status = \"show\" || " + AUTHOR_RULE;
  links.createRule = SUPER_ADMIN_RULE;
  links.updateRule = SUPER_ADMIN_RULE;
  links.deleteRule = SUPER_ADMIN_RULE;
  save(links);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("friend_links");
  if (col) dao.deleteCollection(col);
});
