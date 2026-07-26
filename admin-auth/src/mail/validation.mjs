import { MAIL_LIMITS, isMailCategory } from './constants.mjs';
import { MailError } from './errors.mjs';

const PAYLOAD_KEYS = Object.freeze(['requestId', 'messageId', 'category', 'to', 'subject', 'html', 'text']);
const OPS_KEYS = Object.freeze(['eventId', 'check', 'state', 'observedAt', 'summary']);
const SMTP_OVERRIDE_KEYS = Object.freeze(['host', 'port', 'username', 'password', 'fromAddress', 'fromName', 'tlsMode']);
const TLS_MODES = new Set(['auto', 'implicit', 'starttls']);
const hostPattern = /^[a-z0-9](?:[a-z0-9.-]{0,251})[a-z0-9]$/i;
const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const internalHostSuffixes = new Set(['.internal', '.local', '.lan']);
const internalHostNames = new Set(['localhost']);
// SMTP override 的目标必须是公网 MTA 域名，拒绝 IP 字面量与内网/元数据地址，
// 防止 SSRF（云环境可窃 IAM 元数据）。判定逻辑与 pb_hooks/lib/mail_smtp_config.js
// 的 rejectSmtpHost 保持一致（admin-auth 侧与 PB 侧共用同一规则）。
export function isRejectedSmtpHost(rawHost) {
  if (typeof rawHost !== 'string') return true;
  const host = rawHost.trim().toLowerCase();
  if (!host) return true;
  // IPv6 字面量（含 :），形如 [::1] 或 ::1 / fe80::1
  if (host.includes(':')) return true;
  // IPv4 字面量：拒绝所有（含 169.254.169.254 元数据、127.0.0.1、10/172.16/192.168）
  if (ipv4Pattern.test(host)) return true;
  // 显式内部主机名
  if (internalHostNames.has(host)) return true;
  // 单标签主机名（不含点，如 admin-auth、pb、mailhog）——公网 SMTP 域名必含点
  if (!host.includes('.')) return true;
  // 内部后缀
  for (const suffix of internalHostSuffixes) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}
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

// 请求级 SMTP 配置（PocketBase 后台管理界面下发，优先于环境变量）。
// 仅在已验签的内网请求中有效；校验失败一律 PAYLOAD_INVALID（PB 侧 mail_smtp_config.js
// 对应字段级错误为 INVALID_SMTP_CONFIG: <field>，两侧 host 白名单逻辑保持一致）。
export function validateSmtpOverride(value) {
  assertExactObject(value, SMTP_OVERRIDE_KEYS);
  if (typeof value.host !== 'string' || !hostPattern.test(value.host) || value.host.includes('..')) invalid();
  if (isRejectedSmtpHost(value.host)) invalid();
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) invalid();
  if (typeof value.username !== 'string' || value.username.length === 0 || value.username.length > 320) invalid();
  if (typeof value.password !== 'string' || value.password.length === 0 || value.password.length > 512) invalid();
  if (typeof value.fromAddress !== 'string' || !emailPattern.test(value.fromAddress)) invalid();
  if (typeof value.fromName !== 'string' || value.fromName.length === 0 || [...value.fromName].length > 120) invalid();
  if (typeof value.tlsMode !== 'string' || !TLS_MODES.has(value.tlsMode)) invalid();
  if (/[\r\n]/.test(value.host) || /[\r\n]/.test(value.username) || /[\r\n]/.test(value.fromAddress)) invalid();
  return {
    host: value.host.toLowerCase(),
    port: value.port,
    username: value.username,
    password: value.password,
    fromAddress: value.fromAddress.toLowerCase(),
    fromName: value.fromName,
    tlsMode: value.tlsMode,
  };
}

// 从 send/verify 请求体中分离可选的 smtp override，返回 { rest, smtp }
export function extractSmtpOverride(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { rest: body, smtp: null };
  if (body.smtp === undefined) return { rest: body, smtp: null };
  const smtp = validateSmtpOverride(body.smtp);
  const rest = { ...body };
  delete rest.smtp;
  return { rest, smtp };
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
