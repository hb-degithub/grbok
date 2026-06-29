import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info';
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

  const colors: Record<string, string> = { success: 'bg-success/10 border-success/25 text-success', error: 'bg-danger/10 border-danger/25 text-danger', info: 'bg-accent/10 border-accent/25 text-accent' };

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.95 }} className={"rounded-lg border px-4 py-3 text-sm shadow-lg " + (colors[t.type] || colors.info)}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
