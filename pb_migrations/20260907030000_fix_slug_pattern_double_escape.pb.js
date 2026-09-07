/// <reference path="../pb_data/types.d.ts" />

// 修复 posts/tags 的 slug pattern 因 JSON 双重转义被存成字面 "\u4e00" 六个字符，
// 导致 PocketBase 0.22 的 Go regexp 校验器无法匹配任何真实 slug（含纯 ASCII），
// 所有文章/标签创建与更新全部 400 validation_invalid_format。
// 统一为 \p{Han}（Go regexp 原生支持的汉字类，与 001_init_blog_collections.pb.js 原始意图一致）。
// 该迁移幂等：pattern 已是正确值时直接跳过，重复执行无副作用。

migrate((db) => {
  const dao = new Dao(db);
  const CORRECT = '^[a-zA-Z0-9\\p{Han}][a-zA-Z0-9\\p{Han}_-]*$';

  // 匹配所有已知损坏形态：字面 、双重转义、以及上次生产热修复用的 \p{L}\p{N} 临时写法
  function isBroken(p) {
    if (!p) return false;
    return (
      p.indexOf('\\u4e00') !== -1 ||
      p.indexOf('\\\\u4e00') !== -1 ||
      p.indexOf('\\p{L}') !== -1 ||
      p.indexOf('\\p{N}') !== -1
    );
  }

  function fix(collectionName) {
    let collection;
    try {
      collection = dao.findCollectionByNameOrId(collectionName);
    } catch (_) {
      return; // 集合不存在，跳过
    }
    const field = collection.schema.getFieldByName('slug');
    if (!field) return;
    const current = (field.options && field.options.pattern) || '';
    if (!isBroken(current)) return;
    field.options.pattern = CORRECT;
    dao.saveCollection(collection);
    console.log(`[migration] Fixed broken slug pattern on ${collectionName}.slug (was: ${JSON.stringify(current).slice(0, 80)})`);
  }

  fix('posts');
  fix('tags');
}, (db) => {
  // Rollback: 故意不回滚。旧 pattern 是损坏状态（所有 slug 校验必然失败），
  // 恢复它会重新锁死文章创建。如需回滚请手工调整 slug pattern。
});
