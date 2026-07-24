import { isIP } from 'node:net';

const aliases = Object.freeze({
  SMTP_HOST: 'ALIYUN_SMTP_HOST',
  SMTP_PORT: 'ALIYUN_SMTP_PORT',
  SMTP_USERNAME: 'ALIYUN_SMTP_USER',
  SMTP_PASSWORD: 'ALIYUN_SMTP_PASSWORD',
  SMTP_FROM_ADDRESS: 'ALIYUN_FROM_EMAIL',
  SMTP_FROM_NAME: 'ALIYUN_FROM_NAME',
});

const smtpFields = Object.freeze(Object.keys(aliases));
const tlsModes = new Set(['implicit', 'starttls', 'auto']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createMailConfig(source = {}) {
  const environment = source && typeof source === 'object' ? source : {};
  const values = Object.fromEntries(smtpFields.map((name) => [name, value(environment, name)]));

  try {
    if (smtpFields.every((name) => !values[name])) {
      return unconfiguredMailConfig(environment);
    }
    return configuredMailConfig(environment, values);
  } catch {
    throw invalidMailConfiguration();
  }
}

export function redactMailStatus(config, state = {}, now = new Date()) {
  return {
    configured: Boolean(config.configured),
    port: Number(config.port),
    fromDomain: String(config.fromDomain || ''),
    tlsMode: String(config.tlsMode || 'auto'),
    providerLabel: String(config.providerLabel || ''),
    lastVerify: state.lastVerify ?? null,
    checkedAt: now.toISOString(),
  };
}

function configuredMailConfig(source, values) {
  const host = requireValue(values.SMTP_HOST);
  const port = parsePort(values.SMTP_PORT);
  const username = values.SMTP_USERNAME;
  const password = values.SMTP_PASSWORD;
  const fromAddress = parseEmail(values.SMTP_FROM_ADDRESS);
  const fromName = requireValue(values.SMTP_FROM_NAME);
  const tlsMode = parseTlsMode(source.SMTP_TLS_MODE);
  const localTestMode = parseBoolean(source.MAIL_LOCAL_TEST_MODE);
  const siteUrl = parseSiteUrl(source.PUBLIC_SITE_URL, source.NODE_ENV);
  const alertRecipients = parseAddressList(source.MAIL_ALERT_RECIPIENTS);
  const testRecipientAllowlist = parseAddressList(source.MAIL_TEST_RECIPIENT_ALLOWLIST);

  if (Boolean(username) !== Boolean(password)) {
    throw invalidMailConfiguration();
  }

  if (localTestMode) {
    if (!isLoopbackHost(host) || testRecipientAllowlist.length === 0) {
      throw invalidMailConfiguration();
    }
  } else if (!username || !password) {
    throw invalidMailConfiguration();
  }

  const transport = resolveTls(tlsMode, port);
  return {
    configured: true,
    host,
    port,
    username,
    password,
    fromAddress,
    fromName,
    fromDomain: fromAddress.slice(fromAddress.lastIndexOf('@') + 1).toLowerCase(),
    tlsMode,
    secure: transport.secure,
    requireTLS: transport.requireTLS,
    connectionTimeoutMs: parseTimeout(source.SMTP_CONNECTION_TIMEOUT_MS, 10000, 1000, 30000),
    socketTimeoutMs: parseTimeout(source.SMTP_SOCKET_TIMEOUT_MS, 30000, 3000, 120000),
    providerLabel: optionalValue(source.MAIL_PROVIDER_LABEL) || 'SMTP',
    alertRecipients,
    siteUrl,
    localTestMode,
    testRecipientAllowlist,
  };
}

function unconfiguredMailConfig(source) {
  const tlsMode = parseTlsMode(source.SMTP_TLS_MODE);
  const localTestMode = parseBoolean(source.MAIL_LOCAL_TEST_MODE);
  const rawSiteUrl = optionalValue(source.PUBLIC_SITE_URL);
  const siteUrl = rawSiteUrl ? parseSiteUrl(rawSiteUrl, source.NODE_ENV) : '';
  if (localTestMode) {
    throw invalidMailConfiguration();
  }

  return {
    configured: false,
    host: '',
    port: 0,
    username: '',
    password: '',
    fromAddress: '',
    fromName: '',
    fromDomain: '',
    tlsMode,
    secure: false,
    requireTLS: false,
    connectionTimeoutMs: parseTimeout(source.SMTP_CONNECTION_TIMEOUT_MS, 10000, 1000, 30000),
    socketTimeoutMs: parseTimeout(source.SMTP_SOCKET_TIMEOUT_MS, 30000, 3000, 120000),
    providerLabel: optionalValue(source.MAIL_PROVIDER_LABEL) || 'SMTP',
    alertRecipients: parseAddressList(source.MAIL_ALERT_RECIPIENTS),
    siteUrl,
    localTestMode,
    testRecipientAllowlist: parseAddressList(source.MAIL_TEST_RECIPIENT_ALLOWLIST),
  };
}

function value(source, name) {
  return optionalValue(source[name]) || optionalValue(source[aliases[name]]);
}

function optionalValue(value) {
  return String(value || '').trim();
}

function requireValue(value) {
  if (!value) {
    throw invalidMailConfiguration();
  }
  return value;
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw invalidMailConfiguration();
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw invalidMailConfiguration();
  }
  return port;
}

function parseTlsMode(value) {
  const tlsMode = optionalValue(value) || 'auto';
  if (!tlsModes.has(tlsMode)) {
    throw invalidMailConfiguration();
  }
  return tlsMode;
}

function resolveTls(tlsMode, port) {
  if (tlsMode === 'implicit' || (tlsMode === 'auto' && port === 465)) {
    return { secure: true, requireTLS: false };
  }
  return { secure: false, requireTLS: true };
}

function parseTimeout(value, fallback, minimum, maximum) {
  const timeout = optionalValue(value);
  if (!timeout) {
    return fallback;
  }
  if (!/^\d+$/.test(timeout)) {
    throw invalidMailConfiguration();
  }
  return Math.min(Math.max(Number(timeout), minimum), maximum);
}

function parseEmail(value) {
  const email = requireValue(value);
  if (!emailPattern.test(email)) {
    throw invalidMailConfiguration();
  }
  return email;
}

function parseAddressList(value) {
  const addresses = optionalValue(value)
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  if (addresses.some((address) => !emailPattern.test(address))) {
    throw invalidMailConfiguration();
  }
  return [...new Set(addresses)];
}

function parseSiteUrl(value, nodeEnv) {
  const siteUrl = requireValue(optionalValue(value));
  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw invalidMailConfiguration();
  }
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw invalidMailConfiguration();
  }
  return parsed.toString().replace(/\/$/, '');
}

function parseBoolean(value) {
  const parsed = optionalValue(value).toLowerCase();
  if (!parsed || parsed === 'false') {
    return false;
  }
  if (parsed === 'true') {
    return true;
  }
  throw invalidMailConfiguration();
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
}

function invalidMailConfiguration() {
  return new Error('Invalid mail startup configuration');
}
