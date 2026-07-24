import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface GalleryItem {
  id: string;
  photo: string;
  title?: string;
  description?: string;
}

interface GalleryLightboxProps {
  items: GalleryItem[];
  /** 当前图片完整 URL 列表（与 items 对齐） */
  urls: string[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function getScrollbarWidth() {
  return typeof window !== 'undefined' ? window.innerWidth - document.documentElement.clientWidth : 0;
}

/** 相册灯箱：背板 blur + 大图缩放入场，左右切换、ESC/背板关闭、键盘导航、锁滚动 */
export default function GalleryLightbox({ items, urls, index, onClose, onNavigate }: GalleryLightboxProps) {
  const open = index !== null && items[index];

  // 锁滚动（沿用 SideNav 的滚动条补偿模式）
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = getScrollbarWidth();
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [open]);

  // 键盘导航
  useEffect(() => {
    if (!open || index === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, index, items.length, onClose, onNavigate]);

  // 预加载相邻图片
  useEffect(() => {
    if (!open || index === null) return;
    [index - 1, index + 1].forEach((i) => {
      if (i >= 0 && i < urls.length) {
        const img = new Image();
        img.src = urls[i];
      }
    });
  }, [open, index, urls]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && index !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="查看大图"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {index > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
              aria-label="上一张"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}
          {index < items.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
              aria-label="下一张"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}

          <motion.figure
            key={items[index].id}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="max-h-[90dvh] max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={urls[index]}
              alt={items[index].title || '相册图片'}
              className="max-h-[76dvh] w-auto max-w-full rounded-xl object-contain shadow-2xl"
            />
            <figcaption className="mt-3 flex items-baseline justify-between gap-4 text-sm">
              <span className="min-w-0">
                {items[index].title && <span className="block truncate font-semibold text-white">{items[index].title}</span>}
                {items[index].description && <span className="mt-0.5 block truncate text-zinc-300">{items[index].description}</span>}
              </span>
              <span className="shrink-0 font-mono text-xs text-zinc-400">{index + 1} / {items.length}</span>
            </figcaption>
          </motion.figure>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
