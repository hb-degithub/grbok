import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * 复制链接 / 系统分享。两者使用同一套细线小圆角按钮样式，
 * 只保留 --sf-* 令牌（无 zinc 色阶、无深色主题手工覆写、无玻璃/大圆角）。
 * 复制与 nativeShare 的降级逻辑保持原样。
 */
const BUTTON_CLASS =
  'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-[4px] border border-[var(--sf-line)] px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors duration-200 hover:border-[var(--sf-line-control)] hover:text-[var(--sf-ink)]';

export default function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const nativeShare = async () => {
    try { await navigator.share({ url: window.location.href, title: document.title }); } catch {}
  };

  const canNative = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <motion.button
        type="button"
        onClick={copyLink}
        animate={copied ? { scale: [1, 1.15, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
        aria-label={copied ? '链接已复制' : '复制链接'}
        className={BUTTON_CLASS}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          {copied
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          }
        </svg>
        <span aria-hidden={copied ? undefined : undefined}>{copied ? '已复制' : '复制链接'}</span>
      </motion.button>
      {canNative && (
        <button
          type="button"
          onClick={nativeShare}
          aria-label="分享"
          className={BUTTON_CLASS}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          <span>分享</span>
        </button>
      )}
      <span className="sr-only" aria-live="polite">{copied ? '链接已复制到剪贴板' : ''}</span>
    </div>
  );
}
