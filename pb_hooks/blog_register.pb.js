(function () {
  /// <reference path="../pb_local/pb/pb_data/types.d.ts" />
  routerAdd('POST', '/api/blog-auth/register', function (c) {
    return require(__hooks + '/lib/registration_facade.js').handle(c);
  }, $apis.bodyLimit(8192));

  onBeforeApiError(function (e) {
    if (!e || !e.httpContext || !e.error || String(e.httpContext.path() || '') !== '/api/blog-auth/register') return;
    var status = Number(e.error.statusCode || e.error.status || e.error.code || 0);
    if (status !== 413) return;
    e.httpContext.json(400, { code: 'INVALID_REGISTRATION' });
    return false;
  });
})();
