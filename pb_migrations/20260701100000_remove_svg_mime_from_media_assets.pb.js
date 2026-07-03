/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("media_assets");

  // 移除 SVG MIME 类型，防止存储型 XSS
  // SVG 文件可包含内嵌 JS 脚本，浏览器直接访问文件 URL 时会执行脚本
  const fileField = collection.schema.getFieldByName("file");
  if (fileField && fileField.type === "file") {
    fileField.options.mimeTypes = fileField.options.mimeTypes.filter(t => t !== "image/svg+xml");
  }
  dao.saveCollection(collection);

}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("media_assets");

  // 回滚：重新添加 image/svg+xml
  const fileField = collection.schema.getFieldByName("file");
  if (fileField && fileField.type === "file") {
    if (!fileField.options.mimeTypes.includes("image/svg+xml")) {
      fileField.options.mimeTypes.push("image/svg+xml");
    }
  }
  dao.saveCollection(collection);
});
