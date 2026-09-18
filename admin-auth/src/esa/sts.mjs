// ECS 实例 RAM 角色的 STS 临时凭据提供者。
// 凭据从阿里云元数据服务拉取并自动轮换,不落盘、不进代码、不进数据库。
// 注意:元数据地址是阿里云约定的固定常量(100.100.100.200,链路本地保留段),
// 不是用户可控输入,不存在 SSRF 面;仅允许 http/https 且仅此常量地址。
const METADATA_BASE = 'http://100.100.100.200/latest/meta-data/ram/security-credentials';
const TIMEOUT_MS = 1500;
const EXPIRY_SKEW_MS = 5 * 60 * 1000; // 距过期 5 分钟就换新

let cached = null; // { accessKeyId, accessKeySecret, securityToken, expirationMs }
let probing = null; // 并发的 in-flight Promise 去重

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`metadata http ${response.status}`);
  return response.json();
}

async function load() {
  // 1) 角色名发现:GET .../security-credentials/ 返回纯文本角色名
  const roleRes = await fetch(`${METADATA_BASE}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!roleRes.ok) throw new Error(`metadata http ${roleRes.status}`);
  const roleName = (await roleRes.text()).trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(roleName)) throw new Error('invalid role name');
  // 2) 拉取该角色的 STS 凭据
  const payload = await fetchJson(`${METADATA_BASE}/${encodeURIComponent(roleName)}`);
  if (payload?.Code !== 'Success' || !payload.AccessKeyId || !payload.AccessKeySecret || !payload.SecurityToken) {
    throw new Error('invalid sts payload');
  }
  const expirationMs = Date.parse(payload.Expiration || '');
  if (!Number.isFinite(expirationMs)) throw new Error('invalid sts expiration');
  return {
    accessKeyId: String(payload.AccessKeyId),
    accessKeySecret: String(payload.AccessKeySecret),
    securityToken: String(payload.SecurityToken),
    expirationMs,
  };
}

/** 返回 STS 凭据;实例未绑定 RAM 角色或不在 ECS 上时返回 null(调用方回退手动凭据)。 */
export async function getStsCredentials() {
  if (cached && cached.expirationMs - EXPIRY_SKEW_MS > Date.now()) return cached;
  if (!probing) {
    probing = load().catch(() => null).finally(() => { probing = null; });
  }
  const result = await probing;
  if (result) cached = result;
  return result;
}

/** 测试辅助:清空缓存 */
export function _resetStsCache() {
  cached = null;
  probing = null;
}
