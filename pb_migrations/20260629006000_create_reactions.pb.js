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

  let rxn = find("reactions");
  if (!rxn) {
    rxn = new Collection({ name: "reactions", type: "base", system: false, schema: [] });
  }
  const posts = find("posts");
  const comments = find("comments");
  if (posts) ensureField(rxn, { name: "post_id", type: "relation", required: false, options: { collectionId: posts.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ["title"] } });
  if (comments) ensureField(rxn, { name: "comment_id", type: "relation", required: false, options: { collectionId: comments.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ["author_name"] } });
  ensureField(rxn, { name: "type", type: "select", required: true, options: { maxSelect: 1, values: ["like", "useful", "inspired"] } });
  ensureField(rxn, { name: "fingerprint", type: "text", required: false, options: { min: null, max: 128, pattern: "" } });
  const users = find("users");
  if (users) ensureField(rxn, { name: "user_id", type: "relation", required: false, options: { collectionId: users.id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ["name"] } });
  rxn.listRule = "";
  rxn.viewRule = "";
  rxn.createRule = "";
  rxn.updateRule = null;
  rxn.deleteRule = SUPER_ADMIN_RULE;
  rxn.indexes = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON reactions (COALESCE(post_id,\"\"), COALESCE(comment_id,\"\"), type, COALESCE(fingerprint,\"\"), COALESCE(user_id,\"\"))"
  ];
  save(rxn);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("reactions");
  if (col) dao.deleteCollection(col);
});
