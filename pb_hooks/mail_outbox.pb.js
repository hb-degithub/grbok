(function () {
  cronAdd('mail-outbox-worker', '*/1 * * * *', function () {
    try { require(__hooks + '/lib/mail_outbox.js').processBatch(Date.now(), 20); }
    catch (_) { console.error('[mail-outbox] operation=worker result=INTERNAL_ERROR'); }
  });
})();
