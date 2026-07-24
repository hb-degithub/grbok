migrate((db) => {
  const dao = new Dao(db);

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  const views = dao.findCollectionByNameOrId('page_views');
  ensureField(views, {
    name: 'target',
    type: 'text',
    required: false,
    options: { min: null, max: 500, pattern: '' },
  });
  views.indexes = (views.indexes || []).filter((sql) =>
    String(sql).indexOf('idx_page_views_event_target_created') === -1
  ).concat([
    'CREATE INDEX idx_page_views_event_target_created ON page_views (event, target, created)',
  ]);
  dao.saveCollection(views);
}, (db) => {
  const dao = new Dao(db);
  const views = dao.findCollectionByNameOrId('page_views');
  views.indexes = (views.indexes || []).filter((sql) =>
    String(sql).indexOf('idx_page_views_event_target_created') === -1
  );
  try {
    const field = views.schema.getFieldByName('target');
    if (field) views.schema.removeField(field.id);
  } catch (_) {}
  dao.saveCollection(views);
});
