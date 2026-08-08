/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  
  if (!users) {
    throw new Error("users collection not found");
  }

  // 添加通知偏好字段
  // 注意：迁移脚本禁用原生数组方法（find/push/filter 等），
  // 必须使用 PocketBase 提供的 getFieldByName / addField API
  const addField = (collection, field) => {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  };

  // 评论回复通知偏好（默认开启）
  addField(users, {
    name: "notify_comment_reply",
    type: "bool",
    required: false,
    options: {}
  });

  // 文章评论通知偏好（默认开启）
  addField(users, {
    name: "notify_post_comment",
    type: "bool",
    required: false,
    options: {}
  });

  dao.saveCollection(users);

  // 为现有用户设置默认值（开启通知）
  const existingUsers = dao.findRecordsByFilter("users", "id != ''", "", 500, 0);
  for (let i = 0; i < existingUsers.length; i++) {
    const user = existingUsers[i];
    // 只在字段为空时设置默认值
    if (user.get("notify_comment_reply") === null || user.get("notify_comment_reply") === undefined) {
      user.set("notify_comment_reply", true);
    }
    if (user.get("notify_post_comment") === null || user.get("notify_post_comment") === undefined) {
      user.set("notify_post_comment", true);
    }
    dao.saveRecord(user);
  }

}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  
  if (users) {
    // 回滚：使用 PocketBase API 逐个移除字段
    // 注意：迁移脚本禁用原生数组方法（filter 等），users.schema
    // 是 SchemaFieldList 包装对象而非普通数组，不能使用 .filter()，
    // 必须用 getFieldByName + removeField
    const replyField = users.schema.getFieldByName("notify_comment_reply");
    if (replyField && replyField.id) {
      users.schema.removeField(replyField.id);
    }
    const postCommentField = users.schema.getFieldByName("notify_post_comment");
    if (postCommentField && postCommentField.id) {
      users.schema.removeField(postCommentField.id);
    }
    dao.saveCollection(users);
  }
});
