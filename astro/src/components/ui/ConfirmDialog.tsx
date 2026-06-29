import React from 'react';
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

export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm" onClick={onCancel}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-border bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-black text-text">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onCancel} className="min-h-10 rounded-md border border-border bg-white px-4 text-xs text-text-secondary hover:bg-bg-soft">{cancelLabel || '取消'}</button>
              <button onClick={onConfirm} className={"min-h-10 rounded-md px-4 text-xs text-white " + (danger ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent/90")}>{confirmLabel || '确认'}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
