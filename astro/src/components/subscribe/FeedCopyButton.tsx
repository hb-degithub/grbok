import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface FeedCopyButtonProps {
  /** 要复制的订阅地址 */
  url: string;
}

/** 复制订阅地址按钮：成功显示对勾 1.5s */
export default function FeedCopyButton({ url }: FeedCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默（按钮仍可用）
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleCopy}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-[3px] border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
        copied
          ? 'border-[var(--sf-accent)] bg-[var(--sf-surface)] text-[var(--sf-accent-ink)]'
          : 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-canvas)] hover:bg-[var(--sf-accent-ink)]'
      }`}
      aria-live="polite"
    >
      {copied ? (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" /></svg>
          已复制
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          复制订阅地址
        </>
      )}
    </motion.button>
  );
}
