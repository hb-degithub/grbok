(function () {
  cronAdd('security-rate-bucket-cleanup', '0 * * * *', function () {
    try { require(__hooks + '/lib/security_rate_limit.js').cleanupExpired($app.dao(), Date.now()); }
    catch (error) { console.error('[security-rate] cleanup failed:', String(error && error.message ? error.message : error)); }
  });
})();
