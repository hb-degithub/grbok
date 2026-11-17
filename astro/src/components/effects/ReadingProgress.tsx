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
    // 细线轨道 + 纯色强调色填充：去掉旧版的青绿渐变，也没有发光圆点/内联阴影。
    <div
      className="fixed top-0 left-0 z-[60] h-0.5 w-full bg-[var(--sf-line-soft)] pointer-events-none"
      aria-hidden="true"
    >
      <div
        className="h-full bg-[var(--sf-accent)] transition-[width] duration-100 ease-out"
        style={{ width: progress * 100 + '%' }}
      />
    </div>
  );
}
