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
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const users = find('users');
  if (users) {
    ensureField(users, { name: 'role', type: 'select', required: true, options: { maxSelect: 1, values: ['super_admin', 'admin', 'author', 'reader'] } });
    users.listRule = 'id = @request.auth.id || ' + ADMIN_RULE;
    users.viewRule = 'id = @request.auth.id || ' + ADMIN_RULE;
    users.createRule = SUPER_ADMIN_RULE + ' || @request.data.role = "reader" || @request.data.role = ""';
    users.updateRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.deleteRule = SUPER_ADMIN_RULE;
    save(users);
  }

  const posts = find('posts');
  if (posts) {
    posts.listRule = 'status = "published" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.viewRule = 'status = "published" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.updateRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.deleteRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    save(posts);
  }

  const comments = find('comments');
  if (comments) {
    comments.listRule = 'status = "approved" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && post_id.author.id = @request.auth.id)';
    comments.viewRule = 'status = "approved" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && post_id.author.id = @request.auth.id)';
    comments.createRule = '';
    comments.updateRule = ADMIN_RULE;
    comments.deleteRule = ADMIN_RULE;
    save(comments);
  }

  const tags = find('tags');
  if (tags) {
    tags.listRule = '';
    tags.viewRule = '';
    tags.createRule = AUTHOR_RULE;
    tags.updateRule = AUTHOR_RULE;
    tags.deleteRule = ADMIN_RULE;
    save(tags);
  }

  const postTags = find('post_tags');
  if (postTags) {
    postTags.listRule = '';
    postTags.viewRule = '';
    postTags.createRule = AUTHOR_RULE;
    postTags.updateRule = AUTHOR_RULE;
    postTags.deleteRule = ADMIN_RULE;
    save(postTags);
  }

  const settings = find('settings');
  if (settings) {
    settings.listRule = '';
    settings.viewRule = '';
    settings.createRule = ADMIN_RULE;
    settings.updateRule = ADMIN_RULE;
    settings.deleteRule = SUPER_ADMIN_RULE;
    save(settings);
  }
}, (db) => {});
