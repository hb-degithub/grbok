import React, { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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
    element =>
      !element.hasAttribute('hidden') &&
      !element.classList.contains('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // 键盘监听只注册一次，但回调始终取最新一次渲染的 onCancel，避免重复绑定/陈旧闭包
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // 打开：记录触发元素 → 焦点进入弹窗；关闭：移除 document 监听并把焦点归还。
  // Esc/Tab 挂在 document 上，焦点即使逃逸到弹窗外也能生效（原来只在遮罩 onKeyDown 上处理）。
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (dialog) {
      const target =
        dialog.querySelector<HTMLElement>('[data-dialog-autofocus]') ??
        getFocusableElements(dialog)[0] ??
        dialog;
      target.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const container = dialogRef.current;
      if (!container) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // 焦点在弹窗之外：按 Tab 拉回第一个（Shift+Tab 拉到最后一个）
      if (!active || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // 触发元素可能已随列表刷新被移除，先确认仍在文档中再归还焦点
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          onClick={onCancel}
        >
          <motion.div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5"
          >
            <h3 id={titleId} className="break-words text-sm font-semibold leading-snug text-[var(--sf-ink)]">{title}</h3>
            <p id={descId} className="mt-2 break-words text-sm leading-6 text-[var(--sf-ink-2)]">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-10 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 text-xs text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
              >
                {cancelLabel || '取消'}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={
                  'min-h-10 rounded-[3px] px-4 text-xs font-medium text-[var(--sf-on-accent)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ' +
                  (danger
                    ? 'bg-[var(--sf-danger)] hover:opacity-90'
                    : 'bg-[var(--sf-accent)] hover:bg-[var(--sf-accent-ink)]')
                }
              >
                {confirmLabel || '确认'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
