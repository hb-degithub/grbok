/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const ADMIN_RULE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';
  const AUTHOR_RULE = '@request.auth.role = "author" || ' + ADMIN_RULE;

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function ensureField(collection, field) {
    try {
      const existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  let gallery = find('gallery_items');
  if (!gallery) gallery = new Collection({ name: 'gallery_items', type: 'base', system: false, schema: [] });

  ensureField(gallery, {
    name: 'photo',
    type: 'file',
    required: true,
    options: {
      maxSelect: 1,
      maxSize: 10485760,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      thumbs: ['300x300'],
      protected: false,
    },
  });
  ensureField(gallery, { name: 'title', type: 'text', required: false, options: { min: null, max: 100, pattern: '' } });
  ensureField(gallery, { name: 'description', type: 'text', required: false, options: { min: null, max: 500, pattern: '' } });
  ensureField(gallery, { name: 'album', type: 'text', required: false, options: { min: null, max: 50, pattern: '' } });
  ensureField(gallery, { name: 'sort_order', type: 'number', required: false, options: { min: 0, max: null, noDecimal: true } });
  ensureField(gallery, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['show', 'hidden'] } });

  gallery.listRule = 'status = "show" || ' + AUTHOR_RULE;
  gallery.viewRule = 'status = "show" || ' + AUTHOR_RULE;
  gallery.createRule = AUTHOR_RULE;
  gallery.updateRule = AUTHOR_RULE;
  gallery.deleteRule = '@request.auth.role = "super_admin"';
  gallery.indexes = (gallery.indexes || []).filter((sql) => {
    const text = String(sql);
    return text.indexOf('idx_gallery_items_status_sort_created') === -1
      && text.indexOf('idx_gallery_items_album_status') === -1;
  }).concat([
    'CREATE INDEX idx_gallery_items_status_sort_created ON gallery_items (status, sort_order, created)',
    'CREATE INDEX idx_gallery_items_album_status ON gallery_items (album, status)',
  ]);
  dao.saveCollection(gallery);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('gallery_items')); } catch (_) {}
});
