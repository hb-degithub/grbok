(function () {
  // 作者可编辑自己的文章，但不能转移归属或伪造计数。
  // 只依赖请求事件已有认证记录，不读取 body，不改变 DAO/cron 服务端写入。
  onRecordBeforeCreateRequest(function (e) {
    if (!e.record) throw new BadRequestError('Invalid post.');
    var auth = e.auth || null;
    var nativeAdmin = false;
    try { nativeAdmin = !!e.httpContext.get('admin'); } catch (_) {}
    var role = auth ? String(auth.get('role') || '') : '';
    if (!nativeAdmin && role !== 'admin' && role !== 'super_admin') {
      if (!auth || !auth.id) throw new BadRequestError('Invalid post author.');
      e.record.set('author', auth.id);
      e.record.set('views', 0);
      e.record.set('likes', 0);
    }
    if (typeof e.next === 'function') e.next();
  }, 'posts');

  onRecordBeforeUpdateRequest(function (e) {
    if (!e.record || !e.record.id) throw new BadRequestError('Invalid post.');
    var auth = e.auth || null;
    var nativeAdmin = false;
    try { nativeAdmin = !!e.httpContext.get('admin'); } catch (_) {}
    var role = auth ? String(auth.get('role') || '') : '';
    if (!nativeAdmin && role !== 'admin' && role !== 'super_admin') {
      var stored = $app.dao().findRecordById('posts', e.record.id);
      e.record.set('author', stored.get('author'));
      e.record.set('views', stored.getInt('views') || 0);
      e.record.set('likes', stored.getInt('likes') || 0);
    }
    if (typeof e.next === 'function') e.next();
  }, 'posts');
})();
