/// <reference path="../pb_data/types.d.ts" />

onRecordBeforeCreateRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e);
});

onRecordBeforeUpdateRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e);
});

onRecordBeforeDeleteRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e);
});
