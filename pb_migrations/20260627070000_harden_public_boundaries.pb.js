migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  const SUPER_ADMIN_RULE = '@request.auth.role = "super_admin"';
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
  if (!publicComments) {
    publicComments = new Collection({ name: 'public_comments', type: 'view', system: false, schema: [] });
  }
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

  const settings = find('settings');
  if (settings) {
    settings.listRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.viewRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.createRule = SUPER_ADMIN_RULE;
    settings.updateRule = SUPER_ADMIN_RULE;
    settings.deleteRule = SUPER_ADMIN_RULE;
    save(settings);
  }

  const postTags = find('post_tags');
  if (postTags) {
    const ownPostTagRule = ADMIN_RULE + ' || (' + AUTHOR_OWN_POST_RULE + ')';
    postTags.createRule = ownPostTagRule;
    postTags.updateRule = ownPostTagRule;
    postTags.deleteRule = ownPostTagRule;
    save(postTags);
  }
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('public_comments')); } catch (_) {}
});