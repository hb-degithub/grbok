import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';

const STORAGE_KEY = 'blog-splash-seen';

function hasSeenSplash(): boolean {
  try {
    return !!window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function markSplashSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, Date.now().toString());
  } catch { /* ignore */ }
}

/**
 * 启动动画遮罩
 *
 * 视觉：画布实底 + 细线环 + 方角石墨字，全部来自 --sf-* 令牌；
 * 实底不透明遮罩，不用模糊/渐变/重阴影，动效只保留宽度与透明度节奏。
 */
export default function SplashOverlay() {
  const [visible, setVisible] = useState(false);
  const { isMobile, prefersReducedMotion } = useBreakpoint();

  useEffect(() => {
    // If reduced motion preferred, just mark as seen and skip
    if (prefersReducedMotion) {
      markSplashSeen();
      return;
    }

    if (!hasSeenSplash()) {
      setVisible(true);
    }
  }, [prefersReducedMotion]);

  // Scroll lock while splash is visible
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  const handleComplete = () => {
    markSplashSeen();
    setVisible(false);
  };

  // Auto-dismiss after animation completes
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [visible]);

  // 不提前 return null，让 AnimatePresence 播完 exit 动画再卸载
  return (
    <AnimatePresence onExitComplete={handleComplete}>
      {visible && (
        <motion.div
          key="splash-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--sf-canvas)]"
          role="status"
          aria-label="页面加载中"
        >
          {/* 细线环：唯一的强调色只在环内以极低浓度出现，不发光、不渐变 */}
          <motion.div
            className="absolute rounded-full border border-[var(--sf-line)] bg-[var(--sf-accent)]/5"
            initial={{ width: 0, height: 0, opacity: 0 }}
            animate={{ width: isMobile ? 250 : 400, height: isMobile ? 250 : 400, opacity: 1 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            style={{
              marginLeft: isMobile ? -125 : -200,
              marginTop: isMobile ? -125 : -200,
              top: '50%',
              left: '50%',
            }}
          />
          <div className="relative z-10 flex flex-col items-center">
            {/* Logo: "B" letter */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 15,
              }}
              className="flex h-12 w-12 items-center justify-center rounded-[2px] border border-[var(--sf-line-strong)] bg-[var(--sf-surface)] sm:h-16 sm:w-16"
            >
              <span className="select-none font-mono text-2xl font-black text-[var(--sf-accent-ink)]">B</span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.7, ease: 'easeOut' }}
              className="mt-5 text-xl font-semibold tracking-tight text-[var(--sf-ink)] sm:text-2xl"
            >
              胡巴的博客
            </motion.h1>

            {/* Slogan */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.7, ease: 'easeOut' }}
              className="mt-2 font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]"
            >
              分享技术、思考与生活
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
