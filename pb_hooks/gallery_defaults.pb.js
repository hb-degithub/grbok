onRecordBeforeCreateRequest(function (e) {
  ['title', 'description', 'album'].forEach(function (field) {
    e.record.set(field, String(e.record.get(field) || '').trim());
  });
  var status = String(e.record.get('status') || '').trim();
  if (status === '') {
    status = 'show'; // 仅"未填"给默认值
  } else if (status !== 'show' && status !== 'hidden') {
    throw new BadRequestError('Invalid status: must be "show" or "hidden"');
  }
  e.record.set('status', status);
  if (typeof e.next === 'function') e.next();
}, 'gallery_items');