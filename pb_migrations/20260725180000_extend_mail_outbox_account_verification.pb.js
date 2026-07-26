/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

// 扩展 mail_outbox 的 category / template_key select 值，
// 支持 account_verification 类别（注册邮箱验证走 outbox 队列）。
// 配合 pb_hooks/lib/mail_outbox.js 的 enqueue/render 与
// registration_facade.js / auth_facade.js 的 token+enqueue 改造。
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_outbox');

  const categoryField = collection.schema.getFieldByName('category');
  if (categoryField) {
    const catValues = (categoryField.options && categoryField.options.values) || [];
    if (catValues.indexOf('account_verification') === -1) {
      categoryField.options.values = catValues.concat(['account_verification']);
    }
  }

  const templateField = collection.schema.getFieldByName('template_key');
  if (templateField) {
    const tplValues = (templateField.options && templateField.options.values) || [];
    if (tplValues.indexOf('account_verification') === -1) {
      templateField.options.values = tplValues.concat(['account_verification']);
    }
  }

  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('mail_outbox');

  const categoryField = collection.schema.getFieldByName('category');
  if (categoryField && categoryField.options && Array.isArray(categoryField.options.values)) {
    categoryField.options.values = categoryField.options.values.filter(function (v) { return v !== 'account_verification'; });
  }

  const templateField = collection.schema.getFieldByName('template_key');
  if (templateField && templateField.options && Array.isArray(templateField.options.values)) {
    templateField.options.values = templateField.options.values.filter(function (v) { return v !== 'account_verification'; });
  }

  dao.saveCollection(collection);
});
