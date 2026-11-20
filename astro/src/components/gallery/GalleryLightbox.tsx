import React, { useEffect, useId, useRef } from 'react';
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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      !element.classList.contains('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

function getScrollbarWidth() {
  return typeof window !== 'undefined' ? window.innerWidth - document.documentElement.clientWidth : 0;
}

/**
 * 灯箱控制键：方角细线，浮在实底遮罩上；hover 只换描边到唯一强调色。
 * 黑色遮罩上 `--sf-focus-ring` 的半透明青偏暗，因此键盘焦点额外用
 * 描边/底色的高对比切换兜底（`.focus-ring` 仍负责强制高对比模式下的系统轮廓）。
 */
const controlClass =
  'focus-ring flex h-11 w-11 items-center justify-center rounded-[3px] border border-white/25 bg-white/5 text-white/90 transition-colors hover:border-[var(--sf-accent)] hover:bg-white/10 hover:text-white focus-visible:border-white focus-visible:bg-white/25 focus-visible:text-white';

/**
 * 相册灯箱：实底遮罩 + 大图淡入，左右切换、ESC/背板关闭、键盘导航、锁滚动。
 *
 * 可访问性契约：
 * - dialog 的名称来自当前照片标题（`aria-labelledby`），不是泛化的「查看大图」；
 * - 打开后焦点进入灯箱、Tab/Shift+Tab 在灯箱内循环，关闭后归还给触发照片；
 * - 方向键只在照片范围内切换（到边界不绕回），Esc 与点击遮罩关闭。
 *
 * 遮罩固定用纯黑而不是 `--sf-ink`：`--sf-ink` 在暗色主题会翻成浅色，
 * 用作遮罩会变成浅底白字不可读；纯黑在深浅主题下都能保证图片与白字的对比。
 */
export default function GalleryLightbox({ items, urls, index, onClose, onNavigate }: GalleryLightboxProps) {
  const open = index !== null && Boolean(items[index]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const current = index !== null ? items[index] : undefined;
  const dialogTitle = current?.title ? `查看大图：${current.title}` : '查看大图：相册图片';

  // 打开：记录触发元素 → 焦点进入灯箱；关闭：把焦点归还给触发元素。
  // 触发照片可能随筛选刷新被移除，归还前先确认仍在文档中。
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const target = closeButtonRef.current ?? dialogRef.current;
    target?.focus();

    return () => {
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

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

  // 键盘：Esc / 方向键 / Tab 焦点循环。挂在 document 上，
  // 即使焦点短暂逃逸到遮罩外也能拉回灯箱。
  useEffect(() => {
    if (!open || index === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (index > 0) onNavigate(index - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        if (index < items.length - 1) onNavigate(index + 1);
        return;
      }
      if (e.key !== 'Tab') return;

      const container = dialogRef.current;
      if (!container) return;
      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // 焦点在灯箱之外：按 Tab 拉回第一个（Shift+Tab 拉到最后一个）
      if (!active || !container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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
          ref={dialogRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <h2 id={titleId} className="sr-only">
            {dialogTitle}
          </h2>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={`${controlClass} absolute right-4 top-4 z-10`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {index > 0 && (
            <div className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
                aria-label="上一张"
                className={`${controlClass} pointer-events-auto`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
            </div>
          )}
          {index < items.length - 1 && (
            <div className="pointer-events-none absolute inset-y-0 right-3 z-10 flex items-center">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
                aria-label="下一张"
                className={`${controlClass} pointer-events-auto`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          )}

          <motion.figure
            key={items[index].id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="max-h-[90dvh] max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={urls[index]}
              alt={items[index].title || '相册图片'}
              className="max-h-[76dvh] w-auto max-w-full rounded-[3px] border border-white/15 object-contain"
            />
            <figcaption className="mt-3 flex items-baseline justify-between gap-4">
              <span className="min-w-0">
                {items[index].title && <span className="block truncate text-sm font-medium text-white">{items[index].title}</span>}
                {items[index].description && <span className="mt-0.5 block truncate text-xs text-white/70">{items[index].description}</span>}
              </span>
              <span
                className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-white/60"
                aria-live="polite"
              >
                {index + 1} / {items.length}
              </span>
            </figcaption>
          </motion.figure>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
