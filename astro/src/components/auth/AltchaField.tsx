import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { AltchaFieldHandle, AltchaGateStatus } from '../../lib/captcha';

export type { AltchaFieldHandle, AltchaGateStatus };

/**
 * ALTCHA PoW 人机验证字段（客户端组件）。
 *
 * 协议要点（与服务端并行实现严格对齐）：
 * - 挑战走同源 `GET /api/captcha/challenge`（altcha v1 协议）；
 * - 使用 `altcha@2.3.0`（v2 widget，向下兼容 v1 协议），自定义元素 `<altcha-widget>`；
 * - 校验通过后 widget 派发 `statechange`（`detail.state === 'verified'`，
 *   `detail.payload` 为 base64 字符串），同时把 payload 写进隐藏输入 `name="altcha"`；
 * - 调用方（表单）只关心 `onVerified(payload | null)` 回调，提交时把 payload
 *   放进 JSON body 的 `altcha` 字段。
 *
 * 设计取舍：
 * 1. `import('altcha')` 只在浏览器端执行（SSR 不 import），动态分包，首屏不受影响；
 *    页面 SSR 只输出 `<altcha-widget>` 标签本身，无 JS 时由 `<noscript>` 提示。
 * 2. 前端闸门只做体验层拦截，**不是安全边界**：服务端仍会独立校验 payload。
 *    因此 widget 加载失败 / 挑战接口报错时降级为 `unavailable`（不阻塞提交），
 *    服务端返回 `CAPTCHA_*` 时再由表单提示并调用 `reset()` 重新取挑战。
 * 3. `reset()` 通过自增 key 重新挂载 widget，确保是**重新请求挑战**而不是复用旧
 *    challenge（旧 challenge 已被服务端消费，复用只会触发 CAPTCHA_REPLAY）。
 * 4. altcha@2.3.0 没有 v1 的 `display="bar"` 选项（2.x 已移除），改用
 *    `--altcha-max-width: 100%` + 站点配色令牌让 widget 铺满表单列宽。
 */

/** 同源挑战接口（Caddy 转发到 PocketBase；SSR 与浏览器同源）。 */
const CHALLENGE_URL = '/api/captcha/challenge';
const WIDGET_TAG = 'altcha-widget';

/** widget 的 statechange.detail 结构（见 altcha 的 AltchaStateChangeEvent）。 */
interface AltchaStateChangeDetail {
  state?: string;
  payload?: string;
}

/**
 * 用站点 `--sf-*` 令牌重新着色 widget。
 *
 * altcha 默认用 border-box + 白色底，暗色主题下会突兀；这些 CSS 变量作用在
 * 包裹层上，widget 渲染在 light DOM 里会自然继承。
 */
const WIDGET_STYLE_VARS: Record<string, string> = {
  '--altcha-max-width': '100%',
  '--altcha-color-base': 'var(--sf-surface)',
  '--altcha-color-border': 'var(--sf-line-control)',
  '--altcha-color-border-focus': 'var(--sf-accent)',
  '--altcha-color-text': 'var(--sf-ink)',
  '--altcha-color-error-text': 'var(--sf-danger)',
  '--altcha-color-footer-bg': 'transparent',
  '--altcha-border-radius': '3px',
};

export interface AltchaFieldProps {
  /** 校验结果回调：通过给 payload，任何回退（过期/错误/reset）都给 null。 */
  onVerified: (payload: string | null) => void;
  /** 闸门状态变化回调，供表单禁用提交按钮 / 显示提示。 */
  onStatusChange?: (status: AltchaGateStatus) => void;
  /** 可选：父组件自增该值即可触发一次 `reset()`（key 自增方案）。 */
  resetSignal?: number;
  /** 根节点 id，提示文案节点使用 `${id}-hint`。 */
  id?: string;
  className?: string;
  /** 无障碍名称（widget 自带中文标签，这里仅用于容器描述）。 */
  label?: string;
}

const AltchaField = forwardRef<AltchaFieldHandle, AltchaFieldProps>(function AltchaField(
  { onVerified, onStatusChange, resetSignal, id = 'altcha', className = '', label = '人机验证' }: AltchaFieldProps,
  ref,
) {
  const [status, setStatus] = useState<AltchaGateStatus>('pending');
  /** widget 最近一次自报的状态（unverified / verifying / verified / error / expired）。 */
  const [widgetState, setWidgetState] = useState<string | null>(null);
  /** widget 自定义元素是否已注册（动态 import 成功）。 */
  const [widgetReady, setWidgetReady] = useState(false);
  /** 自增后作为 React key，强制重建 <altcha-widget> → 重新请求挑战。 */
  const [attempt, setAttempt] = useState(0);

  const widgetRef = useRef<HTMLElement | null>(null);
  const onVerifiedRef = useRef(onVerified);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  /** 同时更新本地状态并通知表单（表单据此禁用/启用提交按钮）。 */
  const applyStatus = useCallback((next: AltchaGateStatus) => {
    setStatus(next);
    onStatusChangeRef.current?.(next);
  }, []);

  const reset = useCallback(() => {
    onVerifiedRef.current(null);
    setWidgetState(null);
    setStatus('pending');
    onStatusChangeRef.current?.('pending');
    setAttempt((value) => value + 1);
  }, []);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  /**
   * 动态导入 altcha（含中文语言包），只跑在浏览器：
   * SSR 期间 `window` 不存在，直接跳过，服务端渲染输出静态标签即可。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const load = async () => {
      try {
        await import('altcha');
        // i18n 只是文案，失败不影响 PoW 验证本身，因此单独吞掉异常。
        await import('altcha/i18n/zh-cn').catch(() => undefined);
        if (cancelled) return;
        if (!window.customElements?.get(WIDGET_TAG)) {
          throw new Error('altcha-widget 未注册');
        }
        setWidgetReady(true);
      } catch {
        if (cancelled) return;
        setWidgetReady(false);
        // 加载失败：降级提示 + 放行提交，由服务端兜底校验。
        applyStatus('unavailable');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyStatus, attempt]);

  /**
   * 监听 widget 的 `statechange`。
   *
   * 监听器在元素上直接挂（React 不会把自定义事件透传到自定义元素），
   * 依赖 `attempt`：reset 会重建元素，需要重新绑定新节点。
   */
  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;

    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<AltchaStateChangeDetail>).detail ?? {};
      const nextState = typeof detail.state === 'string' ? detail.state : null;
      setWidgetState(nextState);

      if (nextState === 'verified') {
        const payload =
          typeof detail.payload === 'string' && detail.payload.length > 0 ? detail.payload : null;
        onVerifiedRef.current(payload);
        applyStatus(payload ? 'verified' : 'blocked');
        return;
      }

      if (nextState === 'error') {
        // 挑战接口不可用（网络异常 / 503 CAPTCHA_UNCONFIGURED）。
        // 不硬拦截：提交时缺少 payload，服务端会返回 CAPTCHA_* 错误码。
        onVerifiedRef.current(null);
        applyStatus('unavailable');
        return;
      }

      // unverified / verifying / expired / code：都属于「还未验证」。
      onVerifiedRef.current(null);
      applyStatus('blocked');
    };

    widget.addEventListener('statechange', handleStateChange);
    return () => widget.removeEventListener('statechange', handleStateChange);
  }, [attempt, applyStatus]);

  /** 外部 key 自增式 reset（与 ref.reset() 等价）。 */
  const resetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === undefined || resetSignalRef.current === resetSignal) return;
    resetSignalRef.current = resetSignal;
    reset();
  }, [resetSignal, reset]);

  const unavailable = status === 'unavailable';
  const showHint = status === 'blocked' || unavailable;

  const hint = unavailable
    ? '人机验证组件暂时不可用，可直接提交，服务端会再次校验。'
    : widgetState === 'verifying'
      ? '正在完成人机验证…'
      : widgetState === 'expired'
        ? '验证已过期，正在重新验证…'
        : '请先完成人机验证后再提交。';

  return (
    <div
      className={`space-y-1.5 ${className}`.trim()}
      style={WIDGET_STYLE_VARS as unknown as React.CSSProperties}
      data-altcha-status={status}
      aria-label={label}
      role="group"
    >
      {/* key 放在包裹层：altcha 的 JSX 类型没有继承 React 的 key/Attributes，
          直接写在自定义元素上会类型报错；包裹层同样能强制重建子树。 */}
      <div key={attempt}>
        <altcha-widget
          // altcha 的 JSX 类型把 ref 声明成 `{ current: HTMLElement | null }`（可变），
          // 与 React 的 RefObject（只读 current）不完全一致，这里显式对齐。
          ref={widgetRef as unknown as { current: HTMLElement | null }}
          challengeurl={CHALLENGE_URL}
          name="altcha"
          auto="onload"
          language="zh-cn"
          hidefooter={false}
        />
      </div>

      <noscript>
        <p className="text-xs leading-snug text-[var(--sf-ink-3)]">
          人机验证需要启用 JavaScript，请启用后刷新页面。
        </p>
      </noscript>

      {showHint && (
        <p id={`${id}-hint`} role="status" aria-live="polite" className="text-xs leading-snug text-[var(--sf-ink-3)]">
          {hint}
        </p>
      )}

      {unavailable && (
        <button
          type="button"
          onClick={reset}
          className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
        >
          重新验证
        </button>
      )}

      {/* widget 已注册但尚未自报状态：保持静默，避免加载瞬间闪一下提示。 */}
      {!widgetReady && !unavailable && status === 'pending' && (
        <span className="sr-only" aria-live="polite">
          人机验证加载中
        </span>
      )}
    </div>
  );
});

export default AltchaField;
