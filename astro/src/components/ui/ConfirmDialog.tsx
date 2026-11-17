import React, { useEffect, useRef, useCallback } from 'react';
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

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Auto-focus first focusable element when dialog opens, restore when it closes
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      // Delay to allow AnimatePresence to render
      const timer = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        firstFocusable?.focus();
      });
      return () => cancelAnimationFrame(timer);
    } else {
      // Restore focus to the element that was focused before the dialog opened
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    }
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }

    if (e.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: if focus is on the first element, wrap to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if focus is on the last element, wrap to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          onClick={onCancel}
          onKeyDown={handleKeyDown}
        >
          <motion.div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-desc"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5"
          >
            <h3 id="confirm-dialog-title" className="break-words text-sm font-semibold leading-snug text-[var(--sf-ink)]">{title}</h3>
            <p id="confirm-dialog-desc" className="mt-2 break-words text-sm leading-6 text-[var(--sf-ink-2)]">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="min-h-10 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 text-xs text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
              >
                {cancelLabel || '取消'}
              </button>
              <button
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
