export const MAIL_CATEGORIES = Object.freeze([
  'account_verification',
  'account_password_reset',
  'account_email_change',
  'reader_otp',
  'comment_new',
  'comment_approved',
  'comment_reply',
  'admin_test',
  'ops_alert',
]);

export const MAIL_ERROR_CODES = Object.freeze([
  'MAIL_NOT_CONFIGURED',
  'SMTP_AUTH',
  'SMTP_CONNECTION',
  'SMTP_TIMEOUT',
  'RECIPIENT_TEMPORARY',
  'RECIPIENT_PERMANENT',
  'PAYLOAD_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export const MAIL_LIMITS = Object.freeze({
  subjectChars: 255,
  htmlBytes: 262144,
  textBytes: 131072,
  rawBodyBytes: 401408,
});

export function isMailCategory(value) {
  return MAIL_CATEGORIES.includes(String(value || ''));
}
