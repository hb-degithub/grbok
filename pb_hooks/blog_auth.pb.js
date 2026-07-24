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

  routerAdd('POST', '/api/blog-auth/otp/request', function (e) {
    const startedAt = Date.now();
    const otp = require(__hooks + '/lib/auth_otp.js');
    const facade = require(__hooks + '/lib/auth_facade.js');
    let result;
    try {
      result = otp.requestOtp(e);
    } catch (error) {
      if (otp.isInvalidRequest(error)) {
        return e.json(400, { code: 'INVALID_REQUEST' });
      }
      console.error('[blog-auth] operation=otp-request result=INTERNAL_ERROR');
      facade.waitForMinimum(startedAt, 350);
      return e.json(500, { code: 'INTERNAL_ERROR' });
    }
    facade.waitForMinimum(startedAt, 350);
    return e.json(202, {
      accepted: true,
      challengeId: result.challengeId,
      expiresIn: result.expiresIn,
    });
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/otp/verify', function (e) {
    const otp = require(__hooks + '/lib/auth_otp.js');
    let user;
    try {
      user = otp.verifyOtp(e);
    } catch (error) {
      if (otp.isInvalidCode(error) || otp.isInvalidRequest(error)) {
        return e.json(400, { code: 'INVALID_OR_EXPIRED_CODE' });
      }
      console.error('[blog-auth] operation=otp-verify result=INTERNAL_ERROR');
      return e.json(400, { code: 'INVALID_OR_EXPIRED_CODE' });
    }
    return $apis.recordAuthResponse($app, e, user, { otp: true });
  }, $apis.bodyLimit(4096));

  cronAdd('reader-otp-challenge-cleanup', '0 * * * *', function () {
    const otp = require(__hooks + '/lib/auth_otp.js');
    otp.cleanupExpired();
  });
  // PocketBase bodyLimit errors are raised before the route callback.
  onBeforeApiError(function (e) {
    if (!e || !e.httpContext || !e.error) return;
    const path = String(e.httpContext.path() || '');
    if (
      path !== '/api/blog-auth/password-reset/request'
      && path !== '/api/blog-auth/verification/request'
      && path !== '/api/blog-auth/email-change/request'
      && path !== '/api/blog-auth/otp/request'
      && path !== '/api/blog-auth/otp/verify'
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

    e.httpContext.json(400, {
      code: path === '/api/blog-auth/otp/verify'
        ? 'INVALID_OR_EXPIRED_CODE'
        : 'INVALID_REQUEST',
    });
    return false;
  });
})();
