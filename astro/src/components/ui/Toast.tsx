import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

let toastId = 0;
let globalAddToast: ((text: string, type?: ToastMessage['type']) => void) | null = null;

export function showToast(text: string, type: ToastMessage['type'] = 'info') {
  globalAddToast?.(text, type);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = String(++toastId);
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  useEffect(() => { globalAddToast = addToast; return () => { globalAddToast = null; }; }, [addToast]);

  /**
   * 四态语义保持可区分，配色一律落到令牌 / 语义色：
   *   - 表面：实底 `--sf-surface` + 1px 细线，不再用半透明底与重阴影；
   *   - success 保留 emerald、warning 保留 amber（语义色优先于统一色板）；
   *   - error 用 `--sf-danger` 令牌（深浅主题各自覆写，红仍是语义红）；
   *   - info 用唯一强调色 `--sf-accent` 描边 + 石墨正文。
   */
  const colors: Record<string, string> = {
    success: 'border-emerald-600 bg-[var(--sf-surface)] text-emerald-700 dark:border-emerald-500 dark:text-emerald-400',
    error: 'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)]',
    info: 'border-[var(--sf-accent)] bg-[var(--sf-surface)] text-[var(--sf-ink)]',
    warning: 'border-amber-500 bg-[var(--sf-surface)] text-amber-700 dark:border-amber-400 dark:text-amber-400',
  };

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.95 }} className={"max-w-[min(92vw,22rem)] break-words rounded-[3px] border px-4 py-3 text-sm leading-snug " + (colors[t.type] || colors.info)}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
