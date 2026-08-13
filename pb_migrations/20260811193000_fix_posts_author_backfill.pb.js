/// <reference path="../pb_data/types.d.ts" />

// 修复 20260703100000_make_posts_author_required.pb.js 中的字段名错误
// 原迁移使用 "roles = 'admin'" 查询，但 users 集合字段是 "role"（单数）
// 导致孤儿文章从未被回填 author，更新这些文章时会 400

migrate((db) => {
  const dao = new Dao(db);

  // 查找没有 author 的文章
  let orphans;
  try {
    orphans = dao.findRecordsByFilter("posts", "author = '' || author = null", "", 0);
  } catch (_) {
    // posts 集合不存在，无需迁移
    return;
  }

  if (orphans.length === 0) return;

  // 优先 super_admin，其次 admin
  let owner = null;
  for (const filter of ['role = "super_admin"', 'role = "admin"']) {
    try {
      owner = dao.findFirstRecordByFilter("users", filter, "");
      break;
    } catch (_) {}
  }

  if (!owner) {
    console.warn(`[migration] Found ${orphans.length} post(s) without author, but no admin user exists. Skipping.`);
    return;
  }

  const ownerId = owner.getId();
  for (const post of orphans) {
    post.set("author", ownerId);
    dao.saveRecord(post);
  }
  console.log(`[migration] Backfilled author for ${orphans.length} orphaned post(s) with user ${ownerId}.`);

}, (db) => {
  // Rollback: 无需回滚，回填操作是幂等的
});
