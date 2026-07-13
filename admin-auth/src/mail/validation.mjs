import { MAIL_LIMITS, isMailCategory } from './constants.mjs';
import { MailError } from './errors.mjs';

const PAYLOAD_KEYS = Object.freeze(['requestId', 'messageId', 'category', 'to', 'subject', 'html', 'text']);
const OPS_KEYS = Object.freeze(['eventId', 'check', 'state', 'observedAt', 'summary']);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{19,127}$/;
const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const opsChecks = new Set(['container_caddy', 'container_pocketbase', 'container_admin_auth', 'public_health', 'backup_age', 'disk_usage']);
const opsStates = new Set(['firing', 'recovered']);

export function validateMailPayload(value, config = {}) {
  assertExactObject(value, PAYLOAD_KEYS);
  assertId(value.requestId);
  assertId(value.messageId);
  if (!isMailCategory(value.category)) invalid();

  const to = validateRecipient(value.to);
  assertString(value.subject, { nonEmpty: true, maxChars: MAIL_LIMITS.subjectChars });
  if (/[\r\n]/.test(value.subject)) invalid();
  assertString(value.html, { maxBytes: MAIL_LIMITS.htmlBytes });
  assertString(value.text, { nonEmpty: true, maxBytes: MAIL_LIMITS.textBytes });

  if (config.localTestMode === true) {
    const allowlist = Array.isArray(config.testRecipientAllowlist)
      ? config.testRecipientAllowlist.map((entry) => String(entry).toLowerCase())
      : [];
    if (!allowlist.includes(to)) invalid();
  }

  return {
    requestId: value.requestId, messageId: value.messageId, category: value.category,
    to, subject: value.subject, html: value.html, text: value.text,
  };
}

export function validateOpsEvent(value) {
  assertExactObject(value, OPS_KEYS);
  assertId(value.eventId);
  if (!opsChecks.has(value.check) || !opsStates.has(value.state)) invalid();
  assertString(value.summary, { nonEmpty: true, maxChars: 500 });
  if (typeof value.observedAt !== 'string' || !isCanonicalIsoTimestamp(value.observedAt)) invalid();
  return {
    eventId: value.eventId, check: value.check, state: value.state,
    observedAt: value.observedAt, summary: value.summary,
  };
}

function assertExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
}

function assertId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) invalid();
}

function validateRecipient(value) {
  if (typeof value !== 'string' || value !== value.trim() || !emailPattern.test(value)) invalid();
  if (/[\r\n,<>]/.test(value)) invalid();
  return value.toLowerCase();
}

function assertString(value, options = {}) {
  if (typeof value !== 'string') invalid();
  if (options.nonEmpty && value.length === 0) invalid();
  if (options.maxChars !== undefined && [...value].length > options.maxChars) invalid();
  if (options.maxBytes !== undefined && Buffer.byteLength(value, 'utf8') > options.maxBytes) invalid();
}

function isCanonicalIsoTimestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function invalid() {
  throw new MailError('PAYLOAD_INVALID', false);
}
