import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface VideoBackgroundProps {
  src: string;
  fallbackSrc?: string;
}

/**
 * 滚动绑定视频背景组件
 *
 * 使用 Framer Motion useScroll + useTransform 使视频响应滚动：
 * - 滚动时 opacity 从 0.08 渐降至 0.02
 * - scale 从 1 缓慢放大到 1.05（微视差）
 *
 * 降级策略：
 * 1. prefers-reduced-motion: display: none
 * 2. .webm 不可用 → 回退 .mp4
 * 3. 全失败 → 透明层，白底自动露出
 */
export default function VideoBackground({ src, fallbackSrc }: VideoBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });
  const opacity = useTransform(scrollYProgress, [0, 0.5], [0.08, 0.02]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.05]);

  return (
    <motion.div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity, scale }}
      aria-hidden="true"
    >
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="none"
        className="h-full w-full object-cover"
      >
        <source src={src} type="video/webm" />
        {fallbackSrc && <source src={fallbackSrc} type="video/mp4" />}
      </video>
    </motion.div>
  );
}
