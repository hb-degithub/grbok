migrate((db) => {
  const dao = new Dao(db);

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  const comments = find('comments');
  if (comments) {
    comments.createRule = 'post_id.status = "published"';
    dao.saveCollection(comments);
  }
}, (db) => {});
