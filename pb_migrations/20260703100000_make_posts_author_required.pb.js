/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  // Data migration: assign a default author to any posts where author is null/empty
  try {
    const posts = dao.findRecordsByFilter("posts", "author = '' || author = null", "", 0);
    if (posts.length > 0) {
      let defaultAuthor = null;
      try {
        defaultAuthor = dao.findFirstRecordByFilter("users", "roles = 'admin'", "");
      } catch (_) {
        // No admin user found — skip orphaned records with a warning
        console.warn(`[migration] Found ${posts.length} post(s) without an author, but no admin user exists to assign as default. Skipping.`);
      }
      if (defaultAuthor) {
        const authorId = defaultAuthor.getId();
        for (const post of posts) {
          post.set("author", authorId);
          dao.saveRecord(post);
        }
        console.log(`[migration] Assigned admin "${defaultAuthor.getString("name") || authorId}" as author for ${posts.length} orphaned post(s).`);
      }
    }
  } catch (_) {
    // No posts collection or no orphaned records — safe to continue
  }

  // Make the author field required to prevent posts without an author
  const collection = dao.findCollectionByNameOrId("posts");
  const authorField = collection.schema.getFieldByName("author");
  if (authorField) {
    authorField.required = true;
  }
  dao.saveCollection(collection);

}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("posts");

  // Rollback: set author back to optional
  const authorField = collection.schema.getFieldByName("author");
  if (authorField) {
    authorField.required = false;
  }
  dao.saveCollection(collection);
});
