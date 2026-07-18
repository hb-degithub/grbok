(function () {
  cronAdd('security-rate-bucket-cleanup', '0 * * * *', function () {
    try { require(__hooks + '/lib/security_rate_limit.js').cleanupExpired($app.dao(), Date.now()); }
    catch (_) { console.error('[security-rate] operation=cleanup result=INTERNAL_ERROR'); }
  });
})();
