'use strict';

function writeSecurityAudit(dao, secureContext, event) {
  var collection = dao.findCollectionByNameOrId('admin_security_audits');
  var record = new Record(collection);
  record.set('actor', secureContext && secureContext.actorId ? secureContext.actorId : '');
  record.set('action_code', String(event.actionCode || 'ADMIN_SECURITY_EVENT'));
  record.set('target_type', String(event.targetType || 'admin_security'));
  record.set('target_id', String(event.targetId || ''));
  record.set('before_json', event.before || null);
  record.set('after_json', event.after || null);
  record.set('version', event.version || 1);
  record.set('reference_id', secureContext && secureContext.referenceId
    ? secureContext.referenceId
    : $security.randomStringWithAlphabet(22, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'));
  record.set('priority', event.priority === 'high' ? 'high' : 'normal');
  dao.saveRecord(record);
  return record;
}

module.exports = { writeSecurityAudit: writeSecurityAudit };
