(function () {
'use strict';

var retention = require(__hooks + '/lib/account_retention.js');
var BATCH_LIMIT = 100;

function enabled(name) {
  return String($os.getenv(name) || 'false').toLowerCase() === 'true';
}

function logSummary(job, summary) {
  console.log(JSON.stringify({ job: job, summary: summary }));
}

cronAdd('account-retention-reminders', '17 * * * *', function () {
  if (!enabled('ACCOUNT_RETENTION_REMINDER_ENABLED')) return;
  logSummary('account_retention_reminders', retention.runDueReminders(Date.now(), BATCH_LIMIT));
});

cronAdd('account-retention-cleanup', '43 * * * *', function () {
  if (!enabled('ACCOUNT_RETENTION_DELETE_ENABLED')) return;
  logSummary('account_retention_cleanup', retention.runDueCleanup(Date.now(), BATCH_LIMIT));
});

onRecordAfterUpdateRequest(function (e) {
  if (!e.record || !e.record.verified()) return;
  retention.cancelForVerifiedUser($app.dao(), e.record);
  if (typeof e.next === 'function') e.next();
}, 'users');
})();
