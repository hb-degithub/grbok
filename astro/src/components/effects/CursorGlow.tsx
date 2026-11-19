import { useEffect, useRef, useState } from 'react';
import useBreakpoint from '../../hooks/useBreakpoint';

interface CursorGlowProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * 展示页 Hero 的环境光斑。
 *
 * 改造前：全站常驻 `mousemove` + 固定层跟随，任何页面都在持续重绘。
 * 改造后（轻场景）：
 * - 只在首页 Hero 区域（`.orbital-hero`）内响应指针，离开 Hero 立即隐藏；
 * - 没有 Hero 的页面（内页/后台）不注册任何监听；
 * - 触摸设备、`prefers-reduced-motion: reduce` 直接不渲染；
 * - 单个 rAF 合并指针事件，图层 `pointer-events: none` 且 `aria-hidden`，不参与交互与可访问树。
 *
 * 只在 BaseLayout 的展示页分支挂载；组件内的区域判定是第二道保险。
 */
export default function CursorGlow({
  size = 220,
  color = 'rgba(120, 113, 108, 0.06)',
  className = '',
}: CursorGlowProps) {
  const { isMobile, prefersReducedMotion } = useBreakpoint();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);

  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef({ x: 0, y: 0, visible: false });

  useEffect(() => {
    if (isMobile || prefersReducedMotion) return;
    const scene = document.querySelector<HTMLElement>('.orbital-hero');
    if (!scene) return;

    const flush = () => {
      rafRef.current = null;
      setPosition({ x: pendingRef.current.x, y: pendingRef.current.y });
      setVisible(pendingRef.current.visible);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = scene.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      // 已在区域外且仍然隐藏时不必重绘。
      if (!inside && !pendingRef.current.visible) return;

      pendingRef.current = { x: event.clientX, y: event.clientY, visible: inside };
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    };

    const hide = () => {
      pendingRef.current = { ...pendingRef.current, visible: false };
      setVisible(false);
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
      data-cursor-glow="true"
      className={`pointer-events-none fixed z-30 transition-opacity duration-200 ${className}`}
      style={{
        left: 0,
        top: 0,
        width: size,
        height: size,
        opacity: visible ? 1 : 0,
        transform: `translate3d(${position.x - size / 2}px, ${position.y - size / 2}px, 0)`,
        background: `radial-gradient(circle, ${color}, transparent 70%)`,
      }}
    />
  );
}
