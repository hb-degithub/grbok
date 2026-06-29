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

  let users = find('users');
  if (users) {
    ensureField(users, { name: 'name', type: 'text', required: true, options: { min: null, max: 80, pattern: '' } });
    ensureField(users, { name: 'avatar', type: 'file', required: false, options: { maxSelect: 1, maxSize: 524288, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: [], protected: false } });
    ensureField(users, { name: 'role', type: 'select', required: true, options: { maxSelect: 1, values: ['super_admin', 'admin', 'author', 'reader'] } });
    ensureField(users, { name: 'bio', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
    users.listRule = 'id = @request.auth.id || ' + ADMIN_RULE;
    users.viewRule = 'id = @request.auth.id || ' + ADMIN_RULE;
    users.createRule = SUPER_ADMIN_RULE + ' || @request.data.role = "reader" || @request.data.role = ""';
    users.updateRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.deleteRule = SUPER_ADMIN_RULE;
    save(users);
  }

  // Extend posts with SEO and pinning fields
  let posts = find("posts");
  if (posts) {
    ensureField(posts, { name: "is_pinned", type: "bool", required: false });
    ensureField(posts, { name: "is_featured", type: "bool", required: false });
    ensureField(posts, { name: "seo_title", type: "text", required: false, options: { min: null, max: 160, pattern: "" } });
    ensureField(posts, { name: "seo_description", type: "text", required: false, options: { min: null, max: 320, pattern: "" } });
    ensureField(posts, { name: "seo_keywords", type: "text", required: false, options: { min: null, max: 300, pattern: "" } });
    ensureField(posts, { name: "reading_time", type: "number", required: false, options: { min: 0, max: null, noDecimal: true } });
    ensureField(posts, { name: "archived_at", type: "date", required: false, options: { min: "", max: "" } });
    posts.indexes = posts.indexes || [];
    posts.indexes.push("CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts (is_pinned DESC)");
    posts.indexes.push("CREATE INDEX IF NOT EXISTS idx_posts_featured ON posts (is_featured DESC)");
    save(posts);
  }

  // Extend tags with color and ordering
  let tags = find("tags");
  if (tags) {
    ensureField(tags, { name: "color", type: "text", required: false, options: { min: null, max: 7, pattern: "^#[0-9a-fA-F]{6}$" } });
    ensureField(tags, { name: "sort_order", type: "number", required: false, options: { min: 0, max: null, noDecimal: true } });
    ensureField(tags, { name: "is_featured", type: "bool", required: false });
    save(tags);
  }

}, (db) => {
  // Rollback: migration reverts if needed
  const dao = new Dao(db);
  // Fields are additive; rollback by restoring from backup
  console.log("Rollback not needed - schema additions only");
});
