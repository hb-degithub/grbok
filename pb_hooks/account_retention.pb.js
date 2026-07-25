/// <reference path="../pb_data/types.d.ts" />

// 账号保留定时任务与钩子。
// 注意：handler 内 require + 内联开关检查（JSVM 下顶层/IIFE 变量对 handler 与 cron 不可见）。

cronAdd('account-retention-reminders', '17 * * * *', function () {
  if (String($os.getenv('ACCOUNT_RETENTION_REMINDER_ENABLED') || 'false').toLowerCase() !== 'true') return;
  var summary = require(__hooks + '/lib/account_retention.js').runDueReminders(Date.now(), 100);
  console.log(JSON.stringify({ job: 'account_retention_reminders', summary: summary }));
});

cronAdd('account-retention-cleanup', '43 * * * *', function () {
  if (String($os.getenv('ACCOUNT_RETENTION_DELETE_ENABLED') || 'false').toLowerCase() !== 'true') return;
  var summary = require(__hooks + '/lib/account_retention.js').runDueCleanup(Date.now(), 100);
  console.log(JSON.stringify({ job: 'account_retention_cleanup', summary: summary }));
});

onRecordAfterUpdateRequest(function (e) {
  if (!e.record || !e.record.verified()) return;
  require(__hooks + '/lib/account_retention.js').cancelForVerifiedUser($app.dao(), e.record);
  if (typeof e.next === 'function') e.next();
}, 'users');
