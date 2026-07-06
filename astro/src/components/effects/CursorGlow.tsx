import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';

interface CursorGlowProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * 鼠标跟随光标组件
 * 跟随鼠标移动的光晕效果
 * 触摸设备上返回 null（无鼠标可跟随）
 */
export default function CursorGlow({
  size = 300,
  color = 'rgba(120, 113, 108, 0.05)',
  className = '',
}: CursorGlowProps) {
  const { isMobile } = useBreakpoint();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const isVisibleRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (isMobile) return;

    const flush = () => {
      rafRef.current = null;
      setMousePosition(pendingPos.current);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingPos.current = { x: e.clientX, y: e.clientY };
      if (!isVisibleRef.current) {
        isVisibleRef.current = true;
        setIsVisible(true);
      }
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    const handleMouseLeave = () => {
      isVisibleRef.current = false;
      setIsVisible(false);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isMobile]);

  if (isMobile) return null;

  return (
    <motion.div
      className={`pointer-events-none fixed z-50 ${className}`}
      style={{
        left: mousePosition.x - size / 2,
        top: mousePosition.y - size / 2,
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color}, transparent 70%)`,
      }}
      animate={{
        opacity: isVisible ? 1 : 0,
        scale: isVisible ? 1 : 0.8,
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    />
  );
}
