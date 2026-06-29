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

  let posts = find('posts');
  if (!posts) {
    posts = new Collection({ name: 'posts', type: 'base', system: false, schema: [] });
  }
  ensureField(posts, { name: 'title', type: 'text', required: true, options: { min: 1, max: 160, pattern: '' } });
  ensureField(posts, { name: 'slug', type: 'text', required: true, options: { min: 1, max: 160, pattern: '^[a-zA-Z0-9\\u4e00-\\u9fa5][a-zA-Z0-9\\u4e00-\\u9fa5_-]*$' } });
  ensureField(posts, { name: 'content', type: 'editor', required: true, options: { convertUrls: false } });
  ensureField(posts, { name: 'excerpt', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  ensureField(posts, { name: 'cover', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  ensureField(posts, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['draft', 'published', 'archived'] } });
  if (users) ensureField(posts, { name: 'author', type: 'relation', required: false, options: { collectionId: users.id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ['name', 'email'] } });
  ensureField(posts, { name: 'published_at', type: 'date', required: false, options: { min: '', max: '' } });
  ensureField(posts, { name: 'views', type: 'number', required: false, options: { min: 0, max: null, noDecimal: true } });
  posts.listRule = 'status = "published" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
  posts.viewRule = 'status = "published" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
  posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
  posts.updateRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
  posts.deleteRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
  posts.indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts (slug)',
    'CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts (status, published_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author)'
  ];
  posts = save(posts);

  let comments = find('comments');
  if (!comments) {
    comments = new Collection({ name: 'comments', type: 'base', system: false, schema: [] });
  }
  ensureField(comments, { name: 'post_id', type: 'relation', required: true, options: { collectionId: posts.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['title'] } });
  ensureField(comments, { name: 'author_name', type: 'text', required: true, options: { min: 1, max: 50, pattern: '' } });
  ensureField(comments, { name: 'author_email', type: 'email', required: true, options: { exceptDomains: [], onlyDomains: [] } });
  ensureField(comments, { name: 'content', type: 'text', required: true, options: { min: 1, max: 2000, pattern: '' } });
  ensureField(comments, { name: 'parent_id', type: 'relation', required: false, options: { collectionId: comments.id || '', cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ['author_name'] } });
  ensureField(comments, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['pending', 'approved', 'spam'] } });
  ensureField(comments, { name: 'ip_address', type: 'text', required: false, options: { min: null, max: 100, pattern: '' } });
  comments.listRule = 'status = "approved" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && post_id.author.id = @request.auth.id)';
  comments.viewRule = 'status = "approved" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && post_id.author.id = @request.auth.id)';
  comments.createRule = '';
  comments.updateRule = ADMIN_RULE;
  comments.deleteRule = ADMIN_RULE;
  comments.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments (post_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_comments_email ON comments (author_email)'
  ];
  comments = save(comments);

  // Refresh self relation after the comments collection has an id.
  ensureField(comments, { name: 'parent_id', type: 'relation', required: false, options: { collectionId: comments.id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ['author_name'] } });
  comments = save(comments);

  let tags = find('tags');
  if (!tags) tags = new Collection({ name: 'tags', type: 'base', system: false, schema: [] });
  ensureField(tags, { name: 'name', type: 'text', required: true, options: { min: 1, max: 80, pattern: '' } });
  ensureField(tags, { name: 'slug', type: 'text', required: true, options: { min: 1, max: 100, pattern: '^[a-zA-Z0-9\\u4e00-\\u9fa5][a-zA-Z0-9\\u4e00-\\u9fa5_-]*$' } });
  ensureField(tags, { name: 'description', type: 'text', required: false, options: { min: null, max: 300, pattern: '' } });
  tags.listRule = '';
  tags.viewRule = '';
  tags.createRule = AUTHOR_RULE;
  tags.updateRule = AUTHOR_RULE;
  tags.deleteRule = ADMIN_RULE;
  tags.indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug ON tags (slug)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags (name)'
  ];
  tags = save(tags);

  let postTags = find('post_tags');
  if (!postTags) postTags = new Collection({ name: 'post_tags', type: 'base', system: false, schema: [] });
  ensureField(postTags, { name: 'post_id', type: 'relation', required: true, options: { collectionId: posts.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['title'] } });
  ensureField(postTags, { name: 'tag_id', type: 'relation', required: true, options: { collectionId: tags.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['name'] } });
  postTags.listRule = '';
  postTags.viewRule = '';
  postTags.createRule = AUTHOR_RULE;
  postTags.updateRule = AUTHOR_RULE;
  postTags.deleteRule = ADMIN_RULE;
  postTags.indexes = ['CREATE UNIQUE INDEX IF NOT EXISTS idx_post_tags_pair ON post_tags (post_id, tag_id)'];
  save(postTags);

  let settings = find('settings');
  if (!settings) settings = new Collection({ name: 'settings', type: 'base', system: false, schema: [] });
  ensureField(settings, { name: 'key', type: 'text', required: true, options: { min: 1, max: 120, pattern: '' } });
  ensureField(settings, { name: 'value', type: 'json', required: true, options: { maxSize: 200000 } });
  ensureField(settings, { name: 'description', type: 'text', required: false, options: { min: null, max: 300, pattern: '' } });
  settings.listRule = '';
  settings.viewRule = '';
  settings.createRule = ADMIN_RULE;
  settings.updateRule = ADMIN_RULE;
  settings.deleteRule = SUPER_ADMIN_RULE;
  settings.indexes = ['CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings (`key`)'];
  save(settings);
}, (db) => {
  const dao = new Dao(db);
  for (const name of ['post_tags', 'tags', 'comments', 'posts', 'settings']) {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
