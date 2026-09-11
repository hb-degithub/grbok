(function () {
  cronAdd('mail-outbox-worker', '*/1 * * * *', function () {
    try { require(__hooks + '/lib/mail_outbox.js').processBatch(Date.now(), 20); }
    catch (err) { console.error('[mail-outbox] operation=worker result=INTERNAL_ERROR detail=' + String(err && err.message || err).slice(0, 200)); }
  });
})();
