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

  const users = find('users');
  if (users) {
    users.listRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.viewRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.createRule = SUPER_ADMIN_RULE + ' || @request.data.role = "reader" || @request.data.role = ""';
    users.updateRule = 'id = @request.auth.id || ' + SUPER_ADMIN_RULE;
    users.deleteRule = SUPER_ADMIN_RULE;
    save(users);
  }

  const settings = find('settings');
  if (settings) {
    settings.listRule = '';
    settings.viewRule = '';
    settings.createRule = SUPER_ADMIN_RULE;
    settings.updateRule = SUPER_ADMIN_RULE;
    settings.deleteRule = SUPER_ADMIN_RULE;
    save(settings);
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
}, (db) => {});
