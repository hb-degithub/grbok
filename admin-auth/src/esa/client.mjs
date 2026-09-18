import { createHmac, randomUUID } from 'node:crypto';
import { getStsCredentials } from './sts.mjs';

const ENDPOINT = 'https://esa.cn-hangzhou.aliyuncs.com';
const API_VERSION = '2024-09-10';
const TIMEOUT_MS = 10_000;
const SITE_DOMAIN = 'hlydwz.com';

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

export function signRpcRequest({ accessKeyId, accessKeySecret, securityToken, action, params, nonce, timestamp }) {
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
  // STS 临时凭据必须把 SecurityToken 纳入签名参数
  if (securityToken) all.SecurityToken = securityToken;
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
    return null;
  }
  const { accessKeyId, accessKeySecret, siteId } = credentials;
  const akOk = typeof accessKeyId === 'string' && accessKeyId.length > 0 && accessKeyId.length <= 128;
  const skOk = typeof accessKeySecret === 'string' && accessKeySecret.length > 0 && accessKeySecret.length <= 512;
  // 手动配置存在但凭据本身无效:立即报配置错误,不静默回退(避免掩盖配置笔误)
  if (!akOk || !skOk) throw new EsaError('ESA_NOT_CONFIGURED', false);
  if (siteId !== undefined && siteId !== null && siteId !== 0 && (!Number.isSafeInteger(Number(siteId)) || Number(siteId) < 0)) {
    throw new EsaError('ESA_NOT_CONFIGURED', false);
  }
  const sid = Number(siteId) || 0;
  if (sid < 0) throw new EsaError('ESA_NOT_CONFIGURED', false);
  return { accessKeyId, accessKeySecret, siteId: sid };
}

// 凭据解析顺序:手动配置(后台缓存页) → ECS 实例 RAM 角色 STS(元数据服务)。
// 两者皆无时报 ESA_NOT_CONFIGURED。
let siteIdCache = 0;

async function resolveCredentials(input) {
  const manual = validateCredentials(input);
  if (manual) return manual;
  const sts = await getStsCredentials();
  if (!sts) throw new EsaError('ESA_NOT_CONFIGURED', false);
  return { ...sts, siteId: 0 };
}

async function resolveSiteId(credentials, explicitSiteId) {
  if (explicitSiteId > 0) return explicitSiteId;
  if (credentials.siteId > 0) return credentials.siteId;
  if (siteIdCache > 0) return siteIdCache;
  // 手动配置缺 siteId 或纯 STS 模式:用 ListSites 按主域名反查并缓存
  const payload = await callRpcRaw({
    credentials,
    action: 'ListSites',
    params: { PageSize: '50' },
  });
  const sites = Array.isArray(payload.Sites) ? payload.Sites : [];
  const hit = sites.find((s) => String(s.SiteName || '') === SITE_DOMAIN) || sites[0];
  const id = Number(hit && hit.SiteId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new EsaError('ESA_NOT_CONFIGURED', false);
  siteIdCache = id;
  return id;
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

// 不解析 siteId 的原始 RPC 调用(供 resolveSiteId 自举用)
async function callRpcRaw({ credentials, action, params }) {
  const { accessKeyId, accessKeySecret, securityToken } = credentials;
  const { query, signature } = signRpcRequest({
    accessKeyId,
    accessKeySecret,
    securityToken,
    action,
    params,
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

async function callRpc({ credentials: input, action, params }) {
  const credentials = await resolveCredentials(input);
  const siteId = await resolveSiteId(credentials, Number(input && input.siteId) || 0);
  return callRpcRaw({
    credentials,
    action,
    params: { SiteId: String(siteId), ...params },
  });
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
