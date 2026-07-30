import { createHmac, randomUUID } from 'node:crypto';

const ENDPOINT = 'https://esa.cn-hangzhou.aliyuncs.com';
const API_VERSION = '2024-09-10';
const TIMEOUT_MS = 10_000;

export const ESA_ERROR_CODES = Object.freeze([
  'ESA_NOT_CONFIGURED',
  'ESA_PAYLOAD_INVALID',
  'ESA_QUOTA_EXCEEDED',
  'ESA_RATE_LIMITED',
  'ESA_INVALID_URL',
  'ESA_UPSTREAM_ERROR',
  'INTERNAL_ERROR',
]);

export class EsaError extends Error {
  constructor(code, retryable, cause) {
    super(`ESA request failed: ${code}`);
    this.name = 'EsaError';
    this.code = ESA_ERROR_CODES.includes(code) ? code : 'INTERNAL_ERROR';
    this.retryable = Boolean(retryable);
    if (cause !== undefined) this.cause = cause;
  }
}

// 阿里云 RPC 协议 percentEncode：RFC3986 基础上对 +、*、%7E 做差异化处理
function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function canonicalizedQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

export function signRpcRequest({ accessKeyId, accessKeySecret, action, params, nonce, timestamp }) {
  const all = {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Action: action,
    ...params,
  };
  const query = canonicalizedQuery(all);
  const stringToSign = `POST&%2F&${percentEncode(query)}`;
  const signature = createHmac('sha1', `${accessKeySecret}&`).update(stringToSign, 'utf8').digest('base64');
  return { query, signature };
}

function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function validateCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new EsaError('ESA_NOT_CONFIGURED', false);
  }
  const { accessKeyId, accessKeySecret, siteId } = credentials;
  if (typeof accessKeyId !== 'string' || accessKeyId.length === 0 || accessKeyId.length > 128) {
    throw new EsaError('ESA_NOT_CONFIGURED', false);
  }
  if (typeof accessKeySecret !== 'string' || accessKeySecret.length === 0 || accessKeySecret.length > 512) {
    throw new EsaError('ESA_NOT_CONFIGURED', false);
  }
  if (!Number.isSafeInteger(siteId) || siteId <= 0) {
    throw new EsaError('ESA_NOT_CONFIGURED', false);
  }
  return { accessKeyId, accessKeySecret, siteId };
}

function mapUpstreamError(status, body) {
  const code = body && typeof body.Code === 'string' ? body.Code : '';
  const message = body && typeof body.Message === 'string' ? body.Message.slice(0, 300) : '';
  if (/^QuotaExceeded/.test(code) || /OverThreshold/i.test(code)) {
    return new EsaError('ESA_QUOTA_EXCEEDED', false, message);
  }
  if (code === 'TooManyRequests' || status === 429) {
    return new EsaError('ESA_RATE_LIMITED', true, message);
  }
  if (status === 404) {
    return new EsaError('ESA_INVALID_URL', false, message);
  }
  return new EsaError('ESA_UPSTREAM_ERROR', status >= 500, message || code || `HTTP ${status}`);
}

async function callRpc({ credentials, action, params }) {
  const { accessKeyId, accessKeySecret, siteId } = validateCredentials(credentials);
  const { query, signature } = signRpcRequest({
    accessKeyId,
    accessKeySecret,
    action,
    params: { SiteId: String(siteId), ...params },
    nonce: randomUUID(),
    timestamp: utcTimestamp(),
  });
  const body = `${query}&Signature=${percentEncode(signature)}`;

  let response;
  try {
    response = await fetch(`${ENDPOINT}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new EsaError('ESA_UPSTREAM_ERROR', true, error);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 响应统一按上游错误处理
  }
  if (!response.ok) {
    throw mapUpstreamError(response.status, payload);
  }
  if (!payload || typeof payload !== 'object') {
    throw new EsaError('ESA_UPSTREAM_ERROR', true, 'empty response');
  }
  return payload;
}

const VALID_PURGE_TYPES = new Set(['purgeall', 'file', 'directory']);

function validateUrls(urls, { allowEmpty }) {
  if (!Array.isArray(urls)) {
    throw new EsaError('ESA_PAYLOAD_INVALID', false);
  }
  if (urls.length === 0) {
    if (allowEmpty) return;
    throw new EsaError('ESA_PAYLOAD_INVALID', false);
  }
  if (urls.length > 100) {
    throw new EsaError('ESA_PAYLOAD_INVALID', false);
  }
  for (const url of urls) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 500 || !/^https:\/\//.test(url)) {
      throw new EsaError('ESA_PAYLOAD_INVALID', false);
    }
  }
}

export async function purgeCaches({ credentials, type, urls }) {
  if (!VALID_PURGE_TYPES.has(type)) {
    throw new EsaError('ESA_PAYLOAD_INVALID', false);
  }
  const list = Array.isArray(urls) ? urls : [];
  let content;
  if (type === 'purgeall') {
    validateUrls(list, { allowEmpty: true });
    content = JSON.stringify({ PurgeAll: true });
  } else if (type === 'file') {
    validateUrls(list, { allowEmpty: false });
    content = JSON.stringify({ Files: list });
  } else {
    validateUrls(list, { allowEmpty: false });
    content = JSON.stringify({ Directories: list, Force: true });
  }
  const payload = await callRpc({
    credentials,
    action: 'PurgeCaches',
    params: { Type: type, Content: content },
  });
  if (typeof payload.TaskId !== 'string' || payload.TaskId.length === 0) {
    throw new EsaError('ESA_UPSTREAM_ERROR', true, 'missing TaskId');
  }
  return { ok: true, taskId: payload.TaskId, requestId: String(payload.RequestId || '') };
}

export async function describePurgeTasks({ credentials, taskId }) {
  if (typeof taskId !== 'string' || !/^\d{1,32}$/.test(taskId)) {
    throw new EsaError('ESA_PAYLOAD_INVALID', false);
  }
  const payload = await callRpc({
    credentials,
    action: 'DescribePurgeTasks',
    params: { TaskId: taskId },
  });
  const tasks = Array.isArray(payload.Tasks) ? payload.Tasks : [];
  return {
    ok: true,
    requestId: String(payload.RequestId || ''),
    tasks: tasks.map((task) => ({
      taskId: String(task.TaskId || ''),
      status: String(task.Status || ''),
      type: String(task.Type || ''),
      process: String(task.Process || ''),
      error: String(task.Error || ''),
      description: String(task.Description || ''),
      creationTime: String(task.CreationTime || ''),
    })),
  };
}
