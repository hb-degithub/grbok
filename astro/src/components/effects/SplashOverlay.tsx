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
    const timer = setTimeout(handleComplete, 2500);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <AnimatePresence onExitComplete={handleComplete}>
      {visible && (
        <motion.div
          key="splash-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-white dark:bg-zinc-950"
          role="status"
          aria-label="Loading"
        >
          {/* Teal radial glow behind logo */}
          <motion.div
            className="absolute rounded-full bg-teal-400/20 dark:bg-cyan-400/15"
            initial={{ width: 0, height: 0, opacity: 0 }}
            animate={{ width: isMobile ? 250 : 400, height: isMobile ? 250 : 400, opacity: 1 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            style={{
              marginLeft: isMobile ? -125 : -200,
              marginTop: isMobile ? -125 : -200,
              top: '50%',
              left: '50%',
              background: 'radial-gradient(circle, rgba(20,184,166,0.3) 0%, rgba(20,184,166,0) 70%)',
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
              className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 dark:from-cyan-400 dark:to-cyan-600"
            >
              <span className="text-2xl font-black text-white select-none">B</span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.7, ease: 'easeOut' }}
              className="mt-5 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50"
            >
              胡巴的博客
            </motion.h1>

            {/* Slogan */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.7, ease: 'easeOut' }}
              className="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
            >
              分享技术、思考与生活
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
