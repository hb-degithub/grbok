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
    const stableCode = Object.hasOwn(PUBLIC_MESSAGES, code) ? code : 'INTERNAL_ERROR';
    super(PUBLIC_MESSAGES[stableCode]);
    Object.defineProperty(this, 'name', { configurable: true, value: 'MailError' });
    Object.defineProperty(this, 'message', { configurable: true, enumerable: true, value: this.message });
    this.code = stableCode;
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
  let providerCode;
  let responseCode = Number.NaN;
  try {
    if (error instanceof MailError) return error;
    providerCode = error?.code;
    responseCode = Number(error?.responseCode);
  } catch {
    return new MailError('INTERNAL_ERROR', true, error);
  }

  if (providerCode === 'EAUTH') return new MailError('SMTP_AUTH', false, error);
  if (providerCode === 'ETIMEDOUT' || providerCode === 'ESOCKETTIMEDOUT') {
    return new MailError('SMTP_TIMEOUT', true, error);
  }
  if (['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(providerCode)) {
    return new MailError('SMTP_CONNECTION', true, error);
  }
  if (responseCode === 421) return new MailError('RATE_LIMITED', true, error);
  if (responseCode >= 400 && responseCode < 500) {
    return new MailError('RECIPIENT_TEMPORARY', true, error);
  }
  if (responseCode >= 500 && responseCode < 600) {
    return new MailError('RECIPIENT_PERMANENT', false, error);
  }
  return new MailError('INTERNAL_ERROR', true, error);
}
