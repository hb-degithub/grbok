import { redactMailStatus } from './config.mjs';
import { classifySmtpError, MailError } from './errors.mjs';
import { validateMailPayload, validateOpsEvent } from './validation.mjs';

export function createMailService({ config, transport, createRuntime = null, clock = () => new Date(), logger = () => {} }) {
  let lastVerify = 'never';

  // override 存在时按请求级配置临时构建 config + transport（后台管理界面下发的 SMTP 设置）
  function runtimeFor(override) {
    if (!override) return { config, transport };
    if (typeof createRuntime !== 'function') {
      throw new MailError('MAIL_NOT_CONFIGURED', false);
    }
    return createRuntime(override);
  }

  async function send(payload, override = null) {
    const runtime = runtimeFor(override);
    if (!runtime.config.configured) {
      throw new MailError('MAIL_NOT_CONFIGURED', false);
    }
    const normalized = validateMailPayload(payload, runtime.config);
    try {
      const acceptedAt = currentDate(clock).toISOString();
      await runtime.transport.send(normalized);
      return {
        ok: true,
        requestId: normalized.requestId,
        messageId: normalized.messageId,
        acceptedAt,
      };
    } catch (error) {
      throw classifySmtpError(error);
    }
  }

  async function verify(override = null) {
    const runtime = runtimeFor(override);
    if (!runtime.config.configured) {
      throw new MailError('MAIL_NOT_CONFIGURED', false);
    }
    try {
      await runtime.transport.verify();
      const verifiedAt = currentDate(clock).toISOString();
      lastVerify = 'ok';
      return { ok: true, verifiedAt };
    } catch (error) {
      const classified = classifySmtpError(error);
      lastVerify = classified.code;
      throw classified;
    }
  }

  function status() {
    return redactMailStatus(config, { lastVerify }, currentDate(clock));
  }

  async function sendOpsEvent(value) {
    const event = validateOpsEvent(value);
    requireConfigured(config);
    const escapedSummary = escapeHtml(event.summary);

    for (const [index, to] of config.alertRecipients.entries()) {
      await send({
        requestId: event.eventId,
        messageId: opsMessageId(event.eventId, index + 1),
        category: 'ops_alert',
        to,
        subject: `[博客告警] ${event.check} ${event.state}`,
        html: [
          `<p>Check: ${event.check}</p>`,
          `<p>State: ${event.state}</p>`,
          `<p>Observed at: ${event.observedAt}</p>`,
          `<p>Summary: ${escapedSummary}</p>`,
        ].join(''),
        text: [
          `Check: ${event.check}`,
          `State: ${event.state}`,
          `Observed at: ${event.observedAt}`,
          `Summary: ${event.summary}`,
        ].join('\n'),
      });
    }

    return { sent: config.alertRecipients.length };
  }

  void logger;
  return { send, verify, status, sendOpsEvent };
}

function opsMessageId(eventId, position) {
  const suffix = `_${position}`;
  return eventId.slice(0, 128 - suffix.length) + suffix;
}

function requireConfigured(config) {
  if (!config.configured) {
    throw new MailError('MAIL_NOT_CONFIGURED', false);
  }
}

function currentDate(clock) {
  const value = clock();
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
