import React, { useEffect, useState } from 'react';
export default function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const handler = () => {
      const st = document.documentElement.scrollTop || document.body.scrollTop;
      const sh = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      setProgress(sh > 0 ? Math.min(st / sh, 1) : 0);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);
  return (
    <div className="fixed top-0 left-0 z-[60] h-0.5 w-full bg-zinc-200/50 dark:bg-zinc-800/50 pointer-events-none">
      <div className="h-full bg-zinc-900/70 dark:bg-zinc-100/70 transition-[width] duration-100 ease-out" style={{ width: progress * 100 + '%' }} />
    </div>
  );
}