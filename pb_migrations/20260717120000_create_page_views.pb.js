migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function save(collection) {
    dao.saveCollection(collection);
    return dao.findCollectionByNameOrId(collection.name);
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  let views = find("page_views");
  if (!views) {
    views = new Collection({ name: "page_views", type: "base", system: false, schema: [] });
  }

  // 写入只能走 track-view hook（服务端 dao 绕过 API 规则）；禁止直接 API 创建/更新/删除
  views.createRule = null;
  views.updateRule = null;
  views.deleteRule = null;
  views.listRule = ADMIN_RULE; // 列表仅 admin；公开数据走 /api/blog-stats 聚合接口
  views.viewRule = ADMIN_RULE; // 与 listRule 对齐：admin 能列表也应能查看单条

  ensureField(views, { name: "path", type: "text", required: true, options: { min: 1, max: 200, pattern: "^/" } });
  ensureField(views, { name: "referrer", type: "text", required: false, options: { min: 0, max: 500, pattern: "" } });
  ensureField(views, { name: "ua_category", type: "select", required: true, options: { maxSelect: 1, values: ["mobile", "tablet", "desktop", "bot"] } });
  ensureField(views, { name: "visitor_hash", type: "text", required: true, options: { min: 1, max: 64, pattern: "" } });
  ensureField(views, { name: "event", type: "select", required: true, options: { maxSelect: 1, values: ["pageview", "link_click"] } });

  // 索引（风格对齐仓库先例 audit_logs/reactions：CREATE INDEX IF NOT EXISTS ...）
  views.indexes = [
    'CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views (created)',
    'CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views (path)',
    'CREATE INDEX IF NOT EXISTS idx_page_views_visitor_hash ON page_views (visitor_hash)',
  ];

  save(views);
}, (db) => {
  const dao = new Dao(db);
  try {
    const views = dao.findCollectionByNameOrId("page_views");
    dao.deleteCollection(views);
  } catch (_) {}
});
