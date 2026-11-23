/**
 * ALTCHA 人机验证：前端侧的状态类型 + 服务端错误码映射。
 *
 * 协议（与服务端并行实现对齐，不要单独改）：
 * - 挑战接口：`GET /api/captcha/challenge`（同源）→
 *   `{ algorithm: 'SHA-256', challenge, maxnumber, salt, signature }`
 * - 校验通过后 widget 在隐藏输入 `name="altcha"` 里写入 base64 payload，
 *   并派发 `statechange`（`detail.state === 'verified'`）。
 * - 提交时把 payload 放进 JSON body 的 `altcha` 字段。
 * - 服务端拒绝：HTTP 400 `{ code: 'CAPTCHA_REQUIRED' | 'CAPTCHA_INVALID' |
 *   'CAPTCHA_EXPIRED' | 'CAPTCHA_REPLAY' }` 或 HTTP 503 `{ code: 'CAPTCHA_UNCONFIGURED' }`。
 *
 * 安全边界（重要）：前端只做体验层拦截，最终校验永远在服务端。
 * 因此 widget 不可用（加载失败 / 挑战接口报错）时前端降级放行，
 * 由服务端返回 `CAPTCHA_*` 决定真正结果。
 */

/**
 * ALTCHA 前端闸门状态。
 *
 * - `pending`：widget 尚未报告状态（导入中 / 挑战请求进行中）。此时不拦截提交，
 *   否则任何加载抖动都会让页面彻底不可用；服务端仍是最终裁判。
 * - `blocked`：widget 已明确处于「未验证 / 验证中 / 已过期」，此时禁用提交。
 * - `verified`：已拿到 payload。
 * - `unavailable`：widget 无法工作（动态导入失败、custom element 未注册、
 *   挑战接口错误）。降级放行并给出可读提示。
 */
export type AltchaGateStatus = 'pending' | 'blocked' | 'verified' | 'unavailable';

/** AltchaField 暴露的命令式句柄（服务端校验失败后重新取挑战）。 */
export interface AltchaFieldHandle {
  /** 丢弃旧 payload、重新挂载 widget 并重新请求挑战。 */
  reset: () => void;
}

export const CAPTCHA_ERROR_CODES = [
  'CAPTCHA_REQUIRED',
  'CAPTCHA_INVALID',
  'CAPTCHA_EXPIRED',
  'CAPTCHA_REPLAY',
  'CAPTCHA_UNCONFIGURED',
] as const;

export type CaptchaErrorCode = (typeof CAPTCHA_ERROR_CODES)[number];

/** 服务端错误码 → 中文提示（与需求里给出的文案对齐）。 */
export const CAPTCHA_ERROR_MESSAGES: Record<CaptchaErrorCode, string> = {
  CAPTCHA_REQUIRED: '请先完成人机验证后再提交',
  CAPTCHA_INVALID: '人机验证未通过，请重新验证',
  CAPTCHA_EXPIRED: '验证已过期，请重新验证',
  CAPTCHA_REPLAY: '验证已失效，请重新验证',
  CAPTCHA_UNCONFIGURED: '人机验证服务暂不可用，请稍后重试',
};

export function isCaptchaErrorCode(value: unknown): value is CaptchaErrorCode {
  return typeof value === 'string' && (CAPTCHA_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * PocketBase `ClientResponseError` 把响应体放在 `response`（`pb.send` 的解析结果），
 * 部分调用路径又会包一层 `data`，这里做有限深度（4 层）的探测，避免死循环。
 */
function pickCaptchaCode(value: unknown, depth = 0): CaptchaErrorCode | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  if (isCaptchaErrorCode(record.code)) return record.code;
  for (const key of ['data', 'response']) {
    const nested = pickCaptchaCode(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** 从错误对象里提取已知的 CAPTCHA 错误码；非 CAPTCHA 错误返回 null。 */
export function captchaErrorCode(error: unknown): CaptchaErrorCode | null {
  return pickCaptchaCode(error);
}

export function isCaptchaError(error: unknown): boolean {
  return captchaErrorCode(error) !== null;
}

/** 把 CAPTCHA 错误映射成中文提示；非 CAPTCHA 错误返回 null（调用方走原有兜底）。 */
export function captchaErrorMessage(error: unknown): string | null {
  const code = captchaErrorCode(error);
  return code ? CAPTCHA_ERROR_MESSAGES[code] : null;
}
