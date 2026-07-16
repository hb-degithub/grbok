'use strict';
var rateLimit = require('./security_rate_limit.js');
var policyStore = require('./security_policy_store.js');
var registrationMode = require('./registration_mode.js');
function limited(retryAfter) { var error = new Error('ADMIN_OPERATION_RATE_LIMITED'); error.code = 'ADMIN_OPERATION_RATE_LIMITED'; error.retryAfter = retryAfter; return error; }
function consume(txDao, security) {
  var result = rateLimit.consume(txDao, { nowMs: security.nowMs, entries: [{ policyKey: 'admin_security_write', subject: security.actorId }] });
  if (!result.allowed) throw limited(result.retryAfterSeconds);
}
function updatePolicies(txDao, input, security) {
  consume(txDao, security);
  var before = policyStore.getRatePolicySet(txDao);
  var updated = policyStore.replaceRatePolicySet(txDao, { expectedVersion: input.expectedVersion, policies: input.policies, actorId: security.actorId, now: new Date(security.nowMs) });
  security.writeAudit(txDao, security, { actionCode: 'RATE_POLICY_UPDATED', targetType: 'security_rate_policy', targetId: 'global', before: before, after: updated, version: updated.version });
  return updated;
}
function updateRegistrationMode(txDao, input, security) {
  consume(txDao, security);
  var before = registrationMode.getRegistrationMode(txDao);
  var updated = registrationMode.replaceRegistrationMode(txDao, { expectedVersion: input.expectedVersion, mode: input.mode, actorId: security.actorId, referenceId: security.referenceId, now: new Date(security.nowMs).toISOString() });
  security.writeAudit(txDao, security, { actionCode: 'REGISTRATION_MODE_UPDATED', targetType: 'registration_mode', targetId: 'global', before: before, after: updated, version: updated.version });
  return updated;
}
module.exports = { updatePolicies: updatePolicies, updateRegistrationMode: updateRegistrationMode };
