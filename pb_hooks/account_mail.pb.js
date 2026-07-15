(function () {
  /// <reference path="../pb_local/pb/pb_data/types.d.ts" />

  onMailerBeforeRecordVerificationSend(function (e) {
    var account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_verification', e);
    return false;
  });

  onMailerBeforeRecordResetPasswordSend(function (e) {
    var account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_password_reset', e);
    return false;
  });

  onMailerBeforeRecordChangeEmailSend(function (e) {
    var account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_email_change', e);
    return false;
  });

  onRecordAfterCreateRequest(function (e) {
    var record = e.record;
    if (!record) {
      if (typeof e.next === 'function') e.next();
      return;
    }
    try {
      var account = require(__hooks + '/lib/auth_facade.js');
      account.requestVerificationFor(record);
    } catch (err) {
      console.error('[account-mail] registration auto-send failed:', String(err && err.message ? err.message : err));
    }
    if (typeof e.next === 'function') e.next();
  }, 'users');
})();