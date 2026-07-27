/// <reference path="../pb_data/types.d.ts" />

// 给 page_views 增加访客地理字段（国家/省份代码/城市），
// 配合 stats_geo.js 的解析与 blog-stats 的 geo 聚合。
// 隐私：只存行政区划代码与名称，不存原始 IP（IP 仅用于实时解析后立即丢弃）。

migrate((db) => {
  const dao = new Dao(db);
  const views = dao.findCollectionByNameOrId("page_views");
  if (!views) throw new Error("page_views collection is required before geo migration");

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) {
        field.id = existing.id;
      }
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  // ISO 3166-1 alpha-2 国家代码（如 CN/US/JP），空串表示未识别
  ensureField(views, { name: "country", type: "text", required: false, options: { min: 0, max: 2, pattern: "" } });
  // 省份/州代码（国内用 GB/T 2260 省级拼音码如 beijing，国际用 ISO 3166-2 数字码）
  ensureField(views, { name: "region_code", type: "text", required: false, options: { min: 0, max: 32, pattern: "" } });
  // 城市名（仅记录，地图按省聚合不展示到市）
  ensureField(views, { name: "city", type: "text", required: false, options: { min: 0, max: 100, pattern: "" } });

  views.indexes = (views.indexes || []).concat([
    'CREATE INDEX IF NOT EXISTS idx_page_views_country ON page_views (country)',
    'CREATE INDEX IF NOT EXISTS idx_page_views_region ON page_views (country, region_code)',
  ]);

  dao.saveCollection(views);
}, (db) => {
  // 回滚：移除地理字段（保留数据行）
  const dao = new Dao(db);
  try {
    const views = dao.findCollectionByNameOrId("page_views");
    const names = ["country", "region_code", "city"];
    for (const name of names) {
      try {
        const field = views.schema.getFieldByName(name);
        if (field && field.id) views.schema.removeField(field.id);
      } catch (_) {}
    }
    dao.saveCollection(views);
  } catch (_) {}
});
