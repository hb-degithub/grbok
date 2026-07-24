/// <reference path="../pb_data/types.d.ts" />
//
// 将 feature_flags 加入 settings 表的公开读取白名单。
// feature_flags 仅含功能开关的 enabled/endpoint/frequency 等非敏感配置，
// 前端组件（如 Chatbot Widget）需要匿名读取以决定是否渲染。
// 不含任何密钥、令牌或内部路径。
//
migrate(
  (db) => {
    const dao = new Dao(db);
    const settings = dao.findCollectionByNameOrId('settings');
    if (!settings) return;

    const SUPER_ADMIN_RULE = '@request.auth.role = "super_admin"';
    const PUBLIC_SETTINGS_RULE = [
      'key = "site_title"',
      'key = "site_description"',
      'key = "site_logo"',
      'key = "posts_per_page"',
      'key = "enable_comments"',
      'key = "comment_moderation"',
      'key = "debug_protection_enabled"',
      'key = "feature_flags"',
    ].join(' || ');

    settings.listRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.viewRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    dao.saveCollection(settings);
  },
  (db) => {
    // 回滚：移除 feature_flags 白名单条目
    const dao = new Dao(db);
    const settings = dao.findCollectionByNameOrId('settings');
    if (!settings) return;

    const SUPER_ADMIN_RULE = '@request.auth.role = "super_admin"';
    const PUBLIC_SETTINGS_RULE = [
      'key = "site_title"',
      'key = "site_description"',
      'key = "site_logo"',
      'key = "posts_per_page"',
      'key = "enable_comments"',
      'key = "comment_moderation"',
      'key = "debug_protection_enabled"',
    ].join(' || ');

    settings.listRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    settings.viewRule = '(' + PUBLIC_SETTINGS_RULE + ') || ' + SUPER_ADMIN_RULE;
    dao.saveCollection(settings);
  }
);
