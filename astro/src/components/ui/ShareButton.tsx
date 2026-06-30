import React, { useState } from 'react';

export default function ShareButton() {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const nativeShare = async () => {
    try { await navigator.share({ url: window.location.href, title: document.title }); } catch {}
  };

  const canNative = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className="flex items-center gap-2">
      <button onClick={copyLink} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {copied
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          }
        </svg>
        <span>{copied ? '已复制' : '复制链接'}</span>
      </button>
      {canNative && (
        <button onClick={nativeShare} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          <span>分享</span>
        </button>
      )}
    </div>
  );
}
