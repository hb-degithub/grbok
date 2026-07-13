const PUBLIC_MESSAGES = Object.freeze({
  MAIL_NOT_CONFIGURED: 'Mail service is not configured',
  SMTP_AUTH: 'SMTP authentication failed',
  SMTP_CONNECTION: 'SMTP connection failed',
  SMTP_TIMEOUT: 'SMTP request timed out',
  RECIPIENT_TEMPORARY: 'Recipient was temporarily rejected',
  RECIPIENT_PERMANENT: 'Recipient was rejected',
  PAYLOAD_INVALID: 'PAYLOAD_INVALID: Mail payload is invalid',
  RATE_LIMITED: 'Mail provider rate limit reached',
  INTERNAL_ERROR: 'Internal mail error',
});

export class MailError extends Error {
  constructor(code, retryable, cause) {
    super(PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.INTERNAL_ERROR);
    Object.defineProperty(this, 'name', { configurable: true, value: 'MailError' });
    Object.defineProperty(this, 'message', { configurable: true, enumerable: true, value: this.message });
    this.code = PUBLIC_MESSAGES[code] ? code : 'INTERNAL_ERROR';
    this.retryable = Boolean(retryable);
    Object.defineProperty(this, 'cause', {
      configurable: true, enumerable: false, writable: false, value: cause,
    });
  }

  toJSON() {
    return { code: this.code, retryable: this.retryable, message: this.message };
  }
}

export function classifySmtpError(error) {
  if (error instanceof MailError) return error;

  if (error?.code === 'EAUTH') return new MailError('SMTP_AUTH', false, error);
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
    return new MailError('SMTP_TIMEOUT', true, error);
  }
  if (['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error?.code)) {
    return new MailError('SMTP_CONNECTION', true, error);
  }

  const responseCode = Number(error?.responseCode);
  if (responseCode === 421) return new MailError('RATE_LIMITED', true, error);
  if (responseCode >= 400 && responseCode < 500) {
    return new MailError('RECIPIENT_TEMPORARY', true, error);
  }
  if (responseCode >= 500 && responseCode < 600) {
    return new MailError('RECIPIENT_PERMANENT', false, error);
  }
  return new MailError('INTERNAL_ERROR', true, error);
}
