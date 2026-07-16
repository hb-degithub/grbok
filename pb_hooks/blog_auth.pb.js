(function () {
  /// <reference path="../pb_local/pb/pb_data/types.d.ts" />

  routerAdd('POST', '/api/blog-auth/password-reset/request', function (e) {
    var startedAt = Date.now();
    var publicErrors = require(__hooks + '/lib/public_errors.js');
    var facade = require(__hooks + '/lib/auth_facade.js');
    var referenceId = publicErrors.referenceId();
    try { facade.requestPasswordReset(e); }
    catch (error) {
      if (facade.isInvalidRequest(error)) return e.json(400, { code: 'INVALID_REQUEST' });
      console.error('[blog-auth] operation=password-reset result=INTERNAL_ERROR');
    }
    return e.json(202, publicErrors.accepted(startedAt, referenceId));
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/verification/request', function (e) {
    var startedAt = Date.now();
    var publicErrors = require(__hooks + '/lib/public_errors.js');
    var facade = require(__hooks + '/lib/auth_facade.js');
    var referenceId = publicErrors.referenceId();
    try { facade.requestVerification(e); }
    catch (error) {
      if (facade.isInvalidRequest(error)) return e.json(400, { code: 'INVALID_REQUEST' });
      if (facade.isDetailedRateLimit(error)) return e.json(429, publicErrors.detailedRateLimit(error.code, error.retryAfter, referenceId));
      console.error('[blog-auth] operation=verification result=INTERNAL_ERROR');
    }
    return e.json(202, publicErrors.accepted(startedAt, referenceId));
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/email-change/request', function (e) {
    var startedAt = Date.now();
    var publicErrors = require(__hooks + '/lib/public_errors.js');
    var facade = require(__hooks + '/lib/auth_facade.js');
    var referenceId = publicErrors.referenceId();
    try { facade.requestEmailChange(e); }
    catch (error) {
      if (facade.isInvalidRequest(error)) return e.json(400, { code: 'INVALID_REQUEST' });
      if (facade.isDetailedRateLimit(error)) return e.json(429, publicErrors.detailedRateLimit(error.code, error.retryAfter, referenceId));
      console.error('[blog-auth] operation=email-change result=INTERNAL_ERROR');
    }
    return e.json(202, publicErrors.accepted(startedAt, referenceId));
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/otp/request', function (e) {
    var startedAt = Date.now();
    var publicErrors = require(__hooks + '/lib/public_errors.js');
    var otp = require(__hooks + '/lib/auth_otp.js');
    var referenceId = publicErrors.referenceId();
    var result;
    try {
      result = otp.requestOtp(e);
    } catch (error) {
      if (otp.isInvalidRequest(error)) return e.json(400, { code: 'INVALID_REQUEST' });
      result = { challengeId: $security.randomStringWithAlphabet(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'), expiresIn: 600 };
      console.error('[blog-auth] operation=otp-request result=INTERNAL_ERROR');
    }
    return e.json(202, publicErrors.otpAccepted(startedAt, referenceId, result.challengeId, result.expiresIn));
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/otp/verify', function (e) {
    var otp = require(__hooks + '/lib/auth_otp.js');
    try { return $apis.recordAuthResponse($app, e, otp.verifyOtp(e), { otp: true }); }
    catch (_) { return e.json(400, { code: 'INVALID_OR_EXPIRED_CODE' }); }
  }, $apis.bodyLimit(4096));

  routerAdd('POST', '/api/blog-auth/mfa/otp/request', function (e) {
    var mfa = require(__hooks + '/lib/auth_mfa.js');
    try { return e.json(200, mfa.request(e)); }
    catch (error) {
      if (error && error.code === 'REQUEST_RATE_LIMITED') return e.json(429, { code: error.code, retryAfter: Number(error.retryAfter || 1) });
      if (error && error.code === 'INVALID_REQUEST') return e.json(400, { code: 'INVALID_REQUEST' });
      return e.json(503, { code: 'MFA_UNAVAILABLE' });
    }
  }, $apis.bodyLimit(8192));

  routerAdd('POST', '/api/blog-auth/mfa/otp/verify', function (e) {
    var mfa = require(__hooks + '/lib/auth_mfa.js');
    try { return e.json(200, mfa.verify(e)); }
    catch (error) { return e.json(error && error.code === 'INVALID_REQUEST' ? 400 : 401, { code: error && error.code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'INVALID_OR_EXPIRED_CODE' }); }
  }, $apis.bodyLimit(8192));

  cronAdd('reader-otp-challenge-cleanup', '0 * * * *', function () {
    require(__hooks + '/lib/auth_otp.js').cleanupExpired();
  });

  onBeforeApiError(function (e) {
    if (!e || !e.httpContext || !e.error) return;
    var path = String(e.httpContext.path() || '');
    var managed = [
      '/api/blog-auth/password-reset/request', '/api/blog-auth/verification/request',
      '/api/blog-auth/email-change/request', '/api/blog-auth/otp/request', '/api/blog-auth/otp/verify',
      '/api/blog-auth/mfa/otp/request', '/api/blog-auth/mfa/otp/verify',
    ];
    if (managed.indexOf(path) === -1) return;
    var status = Number(e.error.statusCode || e.error.status || e.error.code || 0);
    if (status !== 413) return;
    e.httpContext.json(400, { code: path === '/api/blog-auth/otp/verify' ? 'INVALID_OR_EXPIRED_CODE' : 'INVALID_REQUEST' });
    return false;
  });
})();
  routerAdd('GET', '/api/blog-auth/mail/health', function (e) {
    return e.json(200, { ok: true, facade: 'mail' });
  });
