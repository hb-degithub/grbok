(function () {
  /// <reference path="../pb_local/pb/pb_data/types.d.ts" />

  routerAdd('POST', '/api/blog-auth/password-reset/request', function (e) {
    const startedAt = Date.now();
    const facade = require(__hooks + '/lib/auth_facade.js');
    try {
      facade.requestPasswordReset(e);
    } catch (error) {
      if (facade.isInvalidRequest(error)) {
        return e.json(400, { code: 'INVALID_REQUEST' });
      }
      console.error('[blog-auth] operation=password-reset result=INTERNAL_ERROR');
    }
    facade.waitForMinimum(startedAt, 350);
    return e.json(202, facade.acceptedResponse());
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/verification/request', function (e) {
    const startedAt = Date.now();
    const facade = require(__hooks + '/lib/auth_facade.js');
    try {
      facade.requestVerification(e);
    } catch (error) {
      if (facade.isInvalidRequest(error)) {
        return e.json(400, { code: 'INVALID_REQUEST' });
      }
      console.error('[blog-auth] operation=verification result=INTERNAL_ERROR');
    }
    facade.waitForMinimum(startedAt, 350);
    return e.json(202, facade.acceptedResponse());
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/email-change/request', function (e) {
    const startedAt = Date.now();
    const facade = require(__hooks + '/lib/auth_facade.js');
    try {
      facade.requestEmailChange(e);
    } catch (error) {
      if (facade.isInvalidRequest(error)) {
        return e.json(400, { code: 'INVALID_REQUEST' });
      }
      console.error('[blog-auth] operation=email-change result=INTERNAL_ERROR');
    }
    facade.waitForMinimum(startedAt, 350);
    return e.json(202, facade.acceptedResponse());
  }, $apis.bodyLimit(4096));

  // PocketBase bodyLimit errors are raised before the route callback.
  onBeforeApiError(function (e) {
    if (!e || !e.httpContext || !e.error) return;
    const path = String(e.httpContext.path() || '');
    if (
      path !== '/api/blog-auth/password-reset/request'
      && path !== '/api/blog-auth/verification/request'
      && path !== '/api/blog-auth/email-change/request'
    ) {
      return;
    }

    const status = Number(
      e.error.statusCode
      || e.error.status
      || e.error.code
      || 0,
    );
    if (status !== 413) return;

    e.httpContext.json(400, { code: 'INVALID_REQUEST' });
    return false;
  });
})();
