/// <reference path="../pb_data/types.d.ts" />

// 为图片类 file 字段补齐 thumb 尺寸白名单。
// 约束：PocketBase 仅在 ?thumb= 命中字段 thumbs 白名单（或默认 "100x100"）时才
// 生成/返回缩略图，其余尺寸静默回退原图（apis/file.go 行为）——前端
// ResponsiveImage 的 srcset（320/640/1024/1600x0）此前因此全部落空。
// 尺寸档位与 astro/src/components/posts/ResponsiveImage.tsx BREAKPOINTS 保持一致，
// 改动任一侧时需同步另一侧。
migrate((db) => {
  const dao = new Dao(db);

  function setThumbs(collectionName, fieldName, thumbs) {
    let collection;
    try {
      collection = dao.findCollectionByNameOrId(collectionName);
    } catch (_) {
      return; // collection 不存在时跳过，保持迁移幂等
    }
    const field = collection.schema.getFieldByName(fieldName);
    if (field && field.type === "file") {
      field.options.thumbs = thumbs;
      dao.saveCollection(collection);
    }
  }

  setThumbs("media_assets", "file", ["300x300", "320x0", "640x0", "1024x0", "1600x0"]);
  setThumbs("gallery_items", "photo", ["300x300", "320x0", "640x0", "1024x0", "1600x0"]);
  // 头像仅需小尺寸展示，不生成宽图
  setThumbs("users", "avatar", ["100x100", "300x300"]);

}, (db) => {
  const dao = new Dao(db);

  function setThumbs(collectionName, fieldName, thumbs) {
    let collection;
    try {
      collection = dao.findCollectionByNameOrId(collectionName);
    } catch (_) {
      return;
    }
    const field = collection.schema.getFieldByName(fieldName);
    if (field && field.type === "file") {
      field.options.thumbs = thumbs;
      dao.saveCollection(collection);
    }
  }

  // 回滚到改造前的白名单
  setThumbs("media_assets", "file", []);
  setThumbs("gallery_items", "photo", ["300x300"]);
  setThumbs("users", "avatar", []);
});
