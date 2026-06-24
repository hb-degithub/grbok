import React, { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  opacity: number;
  speed: number;
}

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const stars: Star[] = [];
    const count = Math.min(Math.floor((width * height) / 5000), 220);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 2 + 0.4,
        size: Math.random() * 1.1 + 0.2,
        opacity: Math.random() * 0.7 + 0.15,
        speed: Math.random() * 0.25 + 0.04,
      });
    }

    let raf = 0;
    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      const now = Date.now();
      for (const s of stars) {
        s.y += s.speed * s.z;
        if (s.y > height) {
          s.y = 0;
          s.x = Math.random() * width;
        }
        const twinkle = 0.85 + Math.sin(now * 0.002 + s.x) * 0.15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * s.z, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 242, 254, ${s.opacity * twinkle})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden="true" />;
}
