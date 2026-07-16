/// <reference path="../pb_data/types.d.ts" />

onRecordBeforeCreateRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e, 'create');
});

onRecordBeforeUpdateRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e, 'update');
});

onRecordBeforeDeleteRequest(function (e) {
  require(__hooks + '/lib/admin_step_up.js').requireProtectedWrite(e, 'delete');
});
