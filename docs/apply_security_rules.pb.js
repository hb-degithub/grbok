// PocketBase migration helper: apply current blog security rules.
// Copy into pb_migrations/ only when you need to re-apply rules to an existing instance.

migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  const SUPER_ADMIN_RULE = '@request.auth.role = "super_admin"';
  const AUTHOR_RULE = '@request.auth.role = "author" || ' + ADMIN_RULE;
  const AUTHOR_OWN_POST_RULE = '@request.auth.role = "author" && post_id.author.id = @request.auth.id';
  const COMMENT_STAFF_RULE = ADMIN_RULE + ' || (' + AUTHOR_OWN_POST_RULE + ')';
  const PUBLIC_SETTINGS_RULE = [
    'key = "site_title"',
    'key = "site_description"',
    'key = "site_logo"',
    'key = "posts_per_page"',
    'key = "enable_comments"',
    'key = "comment_moderation"',
    'key = "debug_protection_enabled"',
  ].join(' || ');

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
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const users = find('users');
  if (users) {
    ensureField(users, {
      name: 'role',
      type: 'select',
      required: true,
      options: { maxSelect: 1, values: ['super_admin', 'admin', 'author', 'reader'] },
    });
    users.listRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.viewRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.createRule = SUPER_ADMIN_RULE + ' || @request.data.role = "reader" || @request.data.role = ""';
    users.updateRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.deleteRule = SUPER_ADMIN_RULE;
    save(users);
  }

  const posts = find('posts');
  if (posts) {
    posts.listRule = 'status = "published" || ' + ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.viewRule = posts.listRule;
    posts.createRule = ADMIN_RULE + ' || (@request.auth.role = "author" && author.id = @request.auth.id)';
    posts.updateRule = posts.createRule;
    posts.deleteRule = posts.createRule;
    save(posts);
  }

  const comments = find('comments');
  if (comments) {
    comments.listRule = COMMENT_STAFF_RULE;
    comments.viewRule = COMMENT_STAFF_RULE;
    comments.createRule = 'post_id.status = "published"';
    comments.updateRule = ADMIN_RULE;
    comments.deleteRule = ADMIN_RULE;
    save(comments);
  }

  let publicComments = find('public_comments');
  if (!publicComments) publicComments = new Collection({ name: 'public_comments', type: 'view', system: false, schema: [] });
  publicComments.type = 'view';
  publicComments.listRule = '';
  publicComments.viewRule = '';
  publicComments.createRule = null;
  publicComments.updateRule = null;
  publicComments.deleteRule = null;
  publicComments.options = {
    query: 'SELECT id, post_id, author_name, content, parent_id, status, created, updated FROM comments WHERE status = "approved"'
  };
  save(publicComments);

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
    const ownPostTagRule = ADMIN_RULE + ' || (' + AUTHOR_OWN_POST_RULE + ')';
    postTags.listRule = '';
    postTags.viewRule = '';
    postTags.createRule = ownPostTagRule;
    postTags.updateRule = ownPostTagRule;
    postTags.deleteRule = ownPostTagRule;
    save(postTags);
  }

  const settings = find('settings');
  if (settings) {
    settings.listRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.viewRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.createRule = SUPER_ADMIN_RULE;
    settings.updateRule = SUPER_ADMIN_RULE;
    settings.deleteRule = SUPER_ADMIN_RULE;
    save(settings);
  }
}, (db) => {});