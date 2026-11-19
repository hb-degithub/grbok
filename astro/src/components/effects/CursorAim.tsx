import { useEffect, useRef, useState } from 'react';
import useBreakpoint from '../../hooks/useBreakpoint';

/**
 * 展示页 Hero 的交互提示环（轻场景）。
 *
 * 改造前：全站十字准星 + 弹性 spring 持续跟随 + 点击脉冲。
 * 改造后：
 * - 只在首页 Hero（`.orbital-hero`）内、且指针落在可交互元素上时才出现；
 * - 离开 Hero 或落在正文/空白处即隐藏，不再有贯穿全站的常驻准星；
 * - 去掉 mousedown/mouseup 脉冲与 spring，单个 rAF 合并事件；
 * - 触摸设备、`prefers-reduced-motion: reduce` 直接不渲染；
 * - 图层 `pointer-events: none` + `aria-hidden`，不影响命中测试与可访问树。
 *
 * 只在 BaseLayout 的展示页分支挂载；组件内的区域判定是第二道保险。
 */

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], input, textarea, select, [tabindex], [role="tab"], [role="link"], [role="menuitem"], [role="checkbox"], [role="switch"]';

/** 提示环尺寸（比旧外圈 40px 更收敛，只做 hover 提示）。 */
const RING_SIZE = 30;

export default function CursorAim() {
  const { isMobile, prefersReducedMotion } = useBreakpoint();
  const [state, setState] = useState({ x: 0, y: 0, visible: false });
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef({ x: 0, y: 0, visible: false });

  useEffect(() => {
    if (isMobile || prefersReducedMotion) return;
    const scene = document.querySelector<HTMLElement>('.orbital-hero');
    if (!scene) return;

    const flush = () => {
      rafRef.current = null;
      setState(pendingRef.current);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = scene.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      const target = event.target as HTMLElement | null;
      const overInteractive =
        inside && !!target?.closest?.(INTERACTIVE_SELECTOR) && scene.contains(target);

      if (!inside && !pendingRef.current.visible) return;

      pendingRef.current = { x: event.clientX, y: event.clientY, visible: overInteractive };
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    };

    const hide = () => {
      pendingRef.current = { ...pendingRef.current, visible: false };
      setState(pendingRef.current);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('blur', hide);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isMobile, prefersReducedMotion]);

  if (isMobile || prefersReducedMotion) return null;

  return (
    <div
      aria-hidden="true"
      data-cursor-aim="true"
      className="pointer-events-none fixed z-30"
      style={{
        left: 0,
        top: 0,
        width: RING_SIZE,
        height: RING_SIZE,
        opacity: state.visible ? 1 : 0,
        transform: `translate3d(${state.x - RING_SIZE / 2}px, ${state.y - RING_SIZE / 2}px, 0)`,
        transition: 'opacity 150ms ease-out',
      }}
    >
      <span
        className="block h-full w-full rounded-full border"
        style={{ borderColor: 'var(--sf-accent-ink)' }}
      />
      <span
        className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ backgroundColor: 'var(--sf-accent-ink)' }}
      />
    </div>
  );
}
