/**
 * 互动接口（点赞/收藏/评论点赞）的共享辅助：
 *   - 浏览器指纹头（**仅辅助信号**，服务端用于限流收紧与留痕，绝不是授权依据）
 *   - 401/403 判定，供 UI 区分「请先登录」与普通失败
 *
 * 授权依据始终是 PocketBase 登录态（Authorization 头）。
 */

/** 服务端识别该头的名字（pb_hooks/lib/action_auth_lib.js: clientFingerprint） */
export const BROWSER_FINGERPRINT_HEADER = 'X-Browser-Fingerprint';

/**
 * 轻量浏览器指纹：同步、无依赖（避免为一次点赞引入 canvas 指纹）。
 * 只在需要时计算并做进程内缓存。SSR 环境返回空串（不发送该头）。
 */
let cachedFingerprint: string | null = null;

export function getActionFingerprint(): string {
  if (cachedFingerprint !== null) return cachedFingerprint;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    cachedFingerprint = '';
    return cachedFingerprint;
  }
  const parts = [
    navigator.userAgent || '',
    typeof screen !== 'undefined' ? `${screen.width}x${screen.height}x${screen.colorDepth}` : '',
    navigator.language || '',
    navigator.platform || '',
    String(new Date().getTimezoneOffset()),
    navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : '',
  ];
  const raw = parts.join('|||');
  // FNV-1a：只需稳定即可，服务端不依赖其密码学性质。
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  cachedFingerprint = `afp-${(hash >>> 0).toString(16)}`;
  return cachedFingerprint;
}

/** 互动请求附加头；指纹不可用时返回空对象（服务端按「未发送」处理） */
export function actionRequestHeaders(): Record<string, string> {
  const fingerprint = getActionFingerprint();
  return fingerprint ? { [BROWSER_FINGERPRINT_HEADER]: fingerprint } : {};
}

/** 未知错误的形状（PocketBase SDK 的 ClientResponseError 子集） */
interface MaybeClientError {
  status?: number;
  response?: { code?: number; data?: { code?: string } };
  data?: { code?: string };
}

/** 是否「未登录 / 登录态失效」——前端据此提示「请先登录」 */
export function isAuthRequiredError(error: unknown): boolean {
  const err = error as MaybeClientError | null | undefined;
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  if (err.response?.code === 401 || err.response?.code === 403) return true;
  if (err.response?.data?.code === 'AUTH_REQUIRED') return true;
  return err.data?.code === 'AUTH_REQUIRED';
}

/** 是否「触发限流」——前端据此提示稍后再试 */
export function isRateLimitedError(error: unknown): boolean {
  const err = error as MaybeClientError | null | undefined;
  if (!err) return false;
  if (err.status === 429) return true;
  return err.response?.code === 429;
}
