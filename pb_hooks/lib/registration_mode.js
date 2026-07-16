'use strict';
var MODES = { open: true, invite_only: true };
function coded(code) { var error = new Error(code); error.code = code; return error; }
function findSingleton(dao) {
  var rows;
  try { rows = dao.findRecordsByFilter('security_registration_mode', 'id != ""', '', 2, 0); }
  catch (_) { throw coded('REGISTRATION_MODE_UNAVAILABLE'); }
  if (!rows || rows.length !== 1) throw coded('REGISTRATION_MODE_UNAVAILABLE');
  return rows[0];
}
function parseRecord(record) {
  var mode = String(record && record.getString('mode') || '');
  var version = Number(record && record.getInt('version'));
  if (!MODES[mode] || !Number.isSafeInteger(version) || version < 1) throw coded('REGISTRATION_MODE_UNAVAILABLE');
  return { mode: mode, version: version };
}
function getRegistrationMode(dao) { return parseRecord(findSingleton(dao)); }
function replaceRegistrationMode(txDao, input) {
  if (!input || !MODES[String(input.mode || '')]) throw coded('INVALID_REGISTRATION_MODE');
  var record = findSingleton(txDao);
  var current = parseRecord(record);
  if (current.version !== Number(input.expectedVersion)) throw coded('REGISTRATION_MODE_VERSION_CONFLICT');
  var actorId = String(input.actorId || '').trim();
  var now = input.now instanceof Date ? input.now.toISOString() : String(input.now || '');
  if (!actorId || actorId.length > 100 || !now) throw coded('INVALID_REGISTRATION_MODE');
  record.set('mode', String(input.mode)); record.set('version', current.version + 1);
  record.set('updated_by', actorId); record.set('updated_at', now); txDao.saveRecord(record);
  return { mode: String(input.mode), version: current.version + 1 };
}
module.exports = { getRegistrationMode: getRegistrationMode, replaceRegistrationMode: replaceRegistrationMode };
