import { useCallback, useRef, useState } from 'react';
import type { AltchaFieldHandle, AltchaGateStatus } from '../lib/captcha';

/**
 * 表单侧的 ALTCHA 闸门状态。
 *
 * 为什么抽成 hook：注册 / 找回密码 / 验证码登录 / 评论重发验证邮件这四个入口
 * 的「payload + 闸门状态 + 重置」语义必须完全一致，否则错误码处理和按钮禁用
 * 会各写一遍、各漏一处。
 *
 * 语义（与 AltchaField 的 status 对应）：
 * - `blocked`：widget 明确报告未验证（unverified / verifying / expired）。
 *   此时禁用提交按钮，并在点击提交时给出「请先完成人机验证」提示。
 * - `degraded`：widget 不可用（导入失败 / 挑战接口报错）。前端降级放行，
 *   由服务端返回 CAPTCHA_* 决定结果。
 * - `pending`：尚未拿到 widget 状态（SSR 首帧、加载中）。不拦截，避免加载抖动
 *   让页面无法提交；服务端仍是最终裁判。
 */
export interface AltchaGate {
  /** 传给 <AltchaField ref={...}> 的引用，用于服务端校验失败后重新取挑战。 */
  ref: React.RefObject<AltchaFieldHandle | null>;
  status: AltchaGateStatus;
  payload: string | null;
  /** 需要禁用提交按钮（widget 明确未验证）。 */
  blocked: boolean;
  /** 人机验证组件不可用，前端已降级。 */
  degraded: boolean;
  onVerified: (payload: string | null) => void;
  onStatusChange: (status: AltchaGateStatus) => void;
  /** 丢弃旧 payload 并重新请求挑战（校验失败 / 成功后调用）。 */
  reset: () => void;
  /** 附加到请求体的可选字段：未验证 / 降级时为空对象，不破坏既有调用。 */
  field: { altcha?: string };
}

export function useAltchaGate(): AltchaGate {
  const [status, setStatus] = useState<AltchaGateStatus>('pending');
  const [payload, setPayload] = useState<string | null>(null);
  const ref = useRef<AltchaFieldHandle | null>(null);

  const onVerified = useCallback((next: string | null) => {
    setPayload(next && next.length > 0 ? next : null);
  }, []);

  const onStatusChange = useCallback((next: AltchaGateStatus) => {
    setStatus(next);
    // 只有 verified 才保留 payload；其余状态（过期/错误/待验证）必须立刻清空，
    // 避免把已消费或无效的 payload 再次提交。
    if (next !== 'verified') setPayload(null);
  }, []);

  const reset = useCallback(() => {
    setStatus('pending');
    setPayload(null);
    ref.current?.reset();
  }, []);

  return {
    ref,
    status,
    payload,
    blocked: status === 'blocked',
    degraded: status === 'unavailable',
    onVerified,
    onStatusChange,
    reset,
    field: payload ? { altcha: payload } : {},
  };
}
