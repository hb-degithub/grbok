(function () {
  cronAdd('mail-outbox-worker', '*/1 * * * *', function () {
    try { require(__hooks + '/lib/mail_outbox.js').processBatch(Date.now(), 20); }
    catch (error) { console.error('[mail-outbox] worker failed:', String(error && error.message ? error.message : error)); }
  });
})();
