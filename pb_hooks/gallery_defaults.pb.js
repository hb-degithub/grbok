onRecordBeforeCreateRequest(function (e) {
  ['title', 'description', 'album'].forEach(function (field) {
    e.record.set(field, String(e.record.get(field) || '').trim());
  });
  var status = String(e.record.get('status') || '').trim();
  e.record.set('status', status === 'hidden' ? 'hidden' : 'show');
  if (typeof e.next === 'function') e.next();
}, 'gallery_items');