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

  let media = find("media_assets");
  if (!media) {
    media = new Collection({ name: "media_assets", type: "base", system: false, schema: [] });
  }
  ensureField(media, { name: "file", type: "file", required: true, options: { maxSelect: 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"], thumbs: [], protected: false } });
  ensureField(media, { name: "alt", type: "text", required: false, options: { min: null, max: 500, pattern: "" } });
  if (find("users")) ensureField(media, { name: "uploader", type: "relation", required: true, options: { collectionId: find("users").id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ["name"] } });
  ensureField(media, { name: "size", type: "number", required: false, options: { min: 0, max: null, noDecimal: true } });
  ensureField(media, { name: "usage_count", type: "number", required: false, options: { min: 0, max: null, noDecimal: true } });
  media.listRule = ADMIN_RULE + " || (@request.auth.role = "author" && uploader.id = @request.auth.id)";
  media.viewRule = ADMIN_RULE + " || (@request.auth.role = "author" && uploader.id = @request.auth.id)";
  media.createRule = AUTHOR_RULE;
  media.updateRule = ADMIN_RULE + " || (@request.auth.role = "author" && uploader.id = @request.auth.id)";
  media.deleteRule = SUPER_ADMIN_RULE + " || (@request.auth.role = "author" && uploader.id = @request.auth.id)";
  save(media);

}, (db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("media_assets");
  if (col) dao.deleteCollection(col);
});
