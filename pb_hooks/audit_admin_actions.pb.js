(function () {
/// <reference path="../pb_data/types.d.ts" />

// PocketBase 0.22 re-evaluates registered callback source in request runtimes.
// Keep each callback self-contained and load the shared implementation there.
onRecordAfterCreateRequest(function (e) {
  try { require(__hooks + '/lib/admin_step_up.js').auditManagedWrite(e, 'create'); }
  catch (_) { console.error('[audit-write-failed] operation=write result=INTERNAL_ERROR'); }
});
onRecordAfterUpdateRequest(function (e) {
  try { require(__hooks + '/lib/admin_step_up.js').auditManagedWrite(e, 'update'); }
  catch (_) { console.error('[audit-write-failed] operation=write result=INTERNAL_ERROR'); }
});
onRecordAfterDeleteRequest(function (e) {
  try { require(__hooks + '/lib/admin_step_up.js').auditManagedWrite(e, 'delete'); }
  catch (_) { console.error('[audit-write-failed] operation=write result=INTERNAL_ERROR'); }
});
})();
