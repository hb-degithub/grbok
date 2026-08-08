import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';

/**
 * 鼠标追踪瞄准组件
 *
 * - 默认：小十字准星跟随鼠标，带弹性延迟
 * - 悬停可交互元素：外圈圆环展开，准星缩小，颜色变为 teal
 * - 点击：短暂脉冲动画
 * - 触摸设备 / prefers-reduced-motion：不渲染
 */

/** 可交互元素选择器 */
const INTERACTIVE_SELECTOR = 'a, button, [role="button"], input, textarea, select, [tabindex], [role="tab"], [role="link"], [role="menuitem"], [role="checkbox"], [role="switch"]';

/** 准星尺寸 */
const CROSS_SIZE = 20;
const CROSS_ARM = 6;
const CROSS_GAP = 3;
const DOT_SIZE = 3;

/** 外圈尺寸 */
const RING_DEFAULT = 0;
const RING_HOVER = 40;

/** 颜色 */
const COLOR_DEFAULT = 'rgba(113, 113, 122, 0.5)'; // zinc-500
const COLOR_HOVER = 'rgba(20, 184, 166, 0.7)'; // teal-500
const RING_COLOR_DEFAULT = 'rgba(113, 113, 122, 0.15)';
const RING_COLOR_HOVER = 'rgba(20, 184, 166, 0.25)';

/** spring 配置（模块级常量，避免每次渲染重建） */
const SPRING_CONFIG = { stiffness: 500, damping: 40, mass: 0.5 };

export default function CursorAim() {
  const { isMobile, prefersReducedMotion } = useBreakpoint();
  const [isVisible, setIsVisible] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const isVisibleRef = useRef(false);
  const hoverRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingEvent = useRef<MouseEvent | null>(null);

  // 鼠标位置（原始值）
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  // 弹性跟随（spring 平滑）
  const x = useSpring(rawX, SPRING_CONFIG);
  const y = useSpring(rawY, SPRING_CONFIG);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    rawX.set(e.clientX);
    rawY.set(e.clientY);

    if (!isVisibleRef.current) {
      // 首次出现时直接跳到鼠标位置，避免从 (0,0) 弹射
      x.jump(e.clientX);
      y.jump(e.clientY);
      isVisibleRef.current = true;
      setIsVisible(true);
    }

    // rAF 节流：每帧最多执行一次 closest() 查询
    pendingEvent.current = e;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const ev = pendingEvent.current;
        if (!ev) return;
        const target = ev.target as HTMLElement;
        const interactive = target.closest?.(INTERACTIVE_SELECTOR);
        const next = !!interactive;
        if (next !== hoverRef.current) {
          hoverRef.current = next;
          setIsHovering(next);
        }
      });
    }
  }, [rawX, rawY, x, y]);

  const handleMouseLeave = useCallback(() => {
    isVisibleRef.current = false;
    hoverRef.current = false;
    setIsVisible(false);
    setIsHovering(false);
    setIsClicking(false);
  }, []);

  const handleMouseDown = useCallback(() => {
    setIsClicking(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsClicking(false);
  }, []);

  // 窗口失焦时重置点击状态（防止拖出窗口后卡死）
  const handleBlur = useCallback(() => {
    setIsClicking(false);
  }, []);

  useEffect(() => {
    if (isMobile || prefersReducedMotion) return;

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isMobile, prefersReducedMotion, handleMouseMove, handleMouseLeave, handleMouseDown, handleMouseUp, handleBlur]);

  if (isMobile || prefersReducedMotion) return null;

  const color = isHovering ? COLOR_HOVER : COLOR_DEFAULT;
  const ringColor = isHovering ? RING_COLOR_HOVER : RING_COLOR_DEFAULT;
  const ringSize = isHovering ? RING_HOVER : RING_DEFAULT;
  const crossScale = isHovering ? 0.6 : 1;
  const clickScale = isClicking ? 0.85 : 1;

  return (
    <>
      {/* 外圈圆环（悬停时展开） */}
      <motion.div
        className="pointer-events-none fixed z-[9998]"
        style={{
          x,
          y,
          translateX: '-50%',
          translateY: '-50%',
        }}
        animate={{
          width: ringSize,
          height: ringSize,
          opacity: isVisible ? (isHovering ? 1 : 0) : 0,
        }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <div
          className="h-full w-full rounded-full border"
          style={{ borderColor: ringColor }}
        />
      </motion.div>

      {/* 十字准星 */}
      <motion.div
        className="pointer-events-none fixed z-[9999]"
        style={{
          x,
          y,
          translateX: '-50%',
          translateY: '-50%',
        }}
        animate={{
          opacity: isVisible ? 1 : 0,
          scale: crossScale * clickScale,
        }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <svg
          width={CROSS_SIZE}
          height={CROSS_SIZE}
          viewBox={`0 0 ${CROSS_SIZE} ${CROSS_SIZE}`}
          fill="none"
        >
          {/* 上 */}
          <line
            x1={CROSS_SIZE / 2}
            y1={CROSS_SIZE / 2 - CROSS_GAP - CROSS_ARM}
            x2={CROSS_SIZE / 2}
            y2={CROSS_SIZE / 2 - CROSS_GAP}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* 下 */}
          <line
            x1={CROSS_SIZE / 2}
            y1={CROSS_SIZE / 2 + CROSS_GAP}
            x2={CROSS_SIZE / 2}
            y2={CROSS_SIZE / 2 + CROSS_GAP + CROSS_ARM}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* 左 */}
          <line
            x1={CROSS_SIZE / 2 - CROSS_GAP - CROSS_ARM}
            y1={CROSS_SIZE / 2}
            x2={CROSS_SIZE / 2 - CROSS_GAP}
            y2={CROSS_SIZE / 2}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* 右 */}
          <line
            x1={CROSS_SIZE / 2 + CROSS_GAP}
            y1={CROSS_SIZE / 2}
            x2={CROSS_SIZE / 2 + CROSS_GAP + CROSS_ARM}
            y2={CROSS_SIZE / 2}
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* 中心点 */}
          <circle
            cx={CROSS_SIZE / 2}
            cy={CROSS_SIZE / 2}
            r={DOT_SIZE / 2}
            fill={color}
          />
        </svg>
      </motion.div>
    </>
  );
}
