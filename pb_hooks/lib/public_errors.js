'use strict';

var ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
var ACCEPTED_MESSAGE = '\u5982\u679c\u8be5\u8d26\u6237\u53ef\u7528\uff0c\u6211\u4eec\u4f1a\u53d1\u9001\u90ae\u4ef6\u3002';

function referenceId() {
  return $security.randomStringWithAlphabet(22, ID_ALPHABET);
}

function waitForMinimum(startedAt, minimumMs) {
  var remaining = Number(minimumMs) - (Date.now() - Number(startedAt));
  if (remaining > 0) sleep(remaining);
}

function accepted(startedAt, id) {
  waitForMinimum(startedAt, 350);
  return {
    accepted: true,
    code: 'MAIL_REQUEST_ACCEPTED',
    message: ACCEPTED_MESSAGE,
    referenceId: String(id),
  };
}

function otpAccepted(startedAt, id, challengeId, expiresIn) {
  var response = accepted(startedAt, id);
  response.challengeId = String(challengeId);
  response.expiresIn = Number(expiresIn);
  return response;
}

function registrationSubmitted(id) {
  return { accepted: true, code: 'REGISTRATION_SUBMITTED', referenceId: String(id) };
}

function detailedRateLimit(code, retryAfter, id) {
  return { code: String(code), retryAfter: Math.max(1, Number(retryAfter) || 1), referenceId: String(id), help: '/help/mail-errors#' + String(code) };
}

module.exports = {
  referenceId: referenceId,
  waitForMinimum: waitForMinimum,
  accepted: accepted,
  otpAccepted: otpAccepted,
  registrationSubmitted: registrationSubmitted,
  detailedRateLimit: detailedRateLimit,
};
