/**
 * ============================================================================
 * STEP-UP 凭证算法 —— 权威实现（SOURCE OF TRUTH）
 * ============================================================================
 * 本文件是 step-up HMAC 绑定校验算法的唯一权威实现。
 *
 * 镜像实现（禁止独立修改）：
 *   - pb_hooks/lib/admin_step_up.js （PocketBase hooks 端 requireAdminStepUp）
 *
 * 任何对算法参数（namespace、拼接顺序、凭证格式、窗口值、比较方式）的修改
 * 必须先在【本文件】完成，再逐行同步到镜像端，并核对 docs/step-up-shared-constants.md。
 * 两端漂移 = 验证不一致 / 绕过路径（P0 安全风险）。
 * ============================================================================
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
const hmac = (secret, namespace, value) => createHmac('sha256', secret)
  .update(`${namespace}:${value}`)
  .digest('hex');

const equalHex = (left, right) => {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createStepUpCredential(binding, { hashSecret, sessionTtlSeconds, nowMs = Date.now() }) {
  const selector = b64url(randomBytes(18));
  const secret = b64url(randomBytes(32));

  return {
    credential: `v1.${selector}.${secret}`,
    record: {
      user: binding.userId,
      selector,
      secret_hmac: hmac(hashSecret, 'step-up-secret', secret),
      client_session_hmac: hmac(hashSecret, 'step-up-client-session', binding.clientSession),
      fingerprint_hash: hmac(hashSecret, 'step-up-fingerprint', binding.fingerprint),
      ip_hash: hmac(hashSecret, 'step-up-ip', binding.ip),
      user_agent_hash: hmac(hashSecret, 'step-up-ua', binding.userAgent),
      verified_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + sessionTtlSeconds * 1000).toISOString(),
      revoked_at: null,
    },
  };
}

export function verifyStepUpCredential(record, binding, hashSecret, nowMs = Date.now()) {
  const parts = String(binding.credential || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] !== record.selector) return false;
  if (record.revoked_at || Date.parse(record.expires_at) <= nowMs || record.user !== binding.userId) return false;

  return equalHex(record.secret_hmac, hmac(hashSecret, 'step-up-secret', parts[2]))
    && equalHex(record.client_session_hmac, hmac(hashSecret, 'step-up-client-session', binding.clientSession))
    && equalHex(record.fingerprint_hash, hmac(hashSecret, 'step-up-fingerprint', binding.fingerprint))
    && equalHex(record.ip_hash, hmac(hashSecret, 'step-up-ip', binding.ip))
    && equalHex(record.user_agent_hash, hmac(hashSecret, 'step-up-ua', binding.userAgent));
}
