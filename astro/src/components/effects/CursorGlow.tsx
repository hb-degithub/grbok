import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface CursorGlowProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * 鼠标跟随光标组件
 * 跟随鼠标移动的光晕效果
 */
export default function CursorGlow({
  size = 300,
  color = 'rgba(34, 211, 238, 0.08)',
  className = '',
}: CursorGlowProps) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
      if (!isVisible) setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isVisible]);

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
