import React, { useEffect, useState } from 'react';
export default function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const handler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const st = document.documentElement.scrollTop || document.body.scrollTop;
        const sh = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        setProgress(sh > 0 ? Math.min(st / sh, 1) : 0);
      });
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => {
      window.removeEventListener('scroll', handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="fixed top-0 left-0 z-[60] h-0.5 w-full bg-zinc-200/50 dark:bg-zinc-800/50 pointer-events-none">
      <div className="relative h-full bg-gradient-to-r from-zinc-900/70 to-teal-500 dark:from-zinc-100/70 dark:to-teal-400 transition-[width] duration-100 ease-out" style={{ width: progress * 100 + '%' }}>
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-teal-400"
          style={{ boxShadow: '0 0 8px 2px rgba(20,184,166,0.5)', opacity: progress > 0.01 ? 1 : 0, transition: 'opacity 0.2s' }}
        />
      </div>
    </div>
  );
}