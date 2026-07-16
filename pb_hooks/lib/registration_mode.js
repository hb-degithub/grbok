'use strict';

var SETTING_KEY = 'security_registration_mode';
var MODES = { open: true, invite_only: true };

function coded(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function parseValue(record) {
  if (!record) return { mode: 'open', version: 1 };
  var value = record.get('value');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { value = null; }
  }
  var mode = String(value && value.mode || '');
  var version = Number(value && value.version);
  if (!MODES[mode] || !Number.isSafeInteger(version) || version < 1) throw coded('REGISTRATION_MODE_UNAVAILABLE');
  return { mode: mode, version: version };
}

function findRecord(dao) {
  var rows = dao.findRecordsByFilter('settings', 'key = {:key}', '', 2, 0, { key: SETTING_KEY });
  if (rows.length > 1) throw coded('REGISTRATION_MODE_UNAVAILABLE');
  return rows.length ? rows[0] : null;
}

function getRegistrationMode(dao) {
  try { return parseValue(findRecord(dao)); }
  catch (error) {
    if (error && error.code === 'REGISTRATION_MODE_UNAVAILABLE') throw error;
    throw coded('REGISTRATION_MODE_UNAVAILABLE');
  }
}

function replaceRegistrationMode(txDao, input) {
  if (!input || !MODES[String(input.mode || '')]) throw coded('INVALID_REGISTRATION_MODE');
  var current = getRegistrationMode(txDao);
  if (current.version !== Number(input.expectedVersion)) throw coded('REGISTRATION_MODE_VERSION_CONFLICT');
  var record = findRecord(txDao);
  if (!record) record = new Record(txDao.findCollectionByNameOrId('settings'));
  var next = {
    mode: String(input.mode), version: current.version + 1,
    actorId: String(input.actorId || ''), referenceId: String(input.referenceId || ''), now: String(input.now || ''),
  };
  record.set('key', SETTING_KEY);
  record.set('value', next);
  record.set('description', 'Private registration security mode');
  txDao.saveRecord(record);
  return { mode: next.mode, version: next.version };
}

module.exports = {
  getRegistrationMode: getRegistrationMode,
  replaceRegistrationMode: replaceRegistrationMode,
};
