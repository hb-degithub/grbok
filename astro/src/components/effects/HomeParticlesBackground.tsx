import { useEffect, useState } from 'react';
import Particles from '../reactbits/Particles';

type Theme = 'light' | 'dark';

function useResolvedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    const sync = () => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('blog-theme-change', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('blog-theme-change', sync);
    };
  }, []);

  return theme;
}

export default function HomeParticlesBackground() {
  const theme = useResolvedTheme();
  const isDark = theme === 'dark';

  return (
    <div className="home-particles-bg" aria-hidden="true">
      <Particles
        particleCount={isDark ? 400 : 300}
        particleSpread={12}
        speed={0.15}
        particleColors={isDark
          ? ['#22d3ee', '#38bdf8', '#818cf8', '#e0f2fe']
          : ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd']
        }
        moveParticlesOnHover={true}
        particleHoverFactor={2}
        alphaParticles={true}
        particleBaseSize={isDark ? 120 : 90}
        sizeRandomness={1.5}
        cameraDistance={20}
        disableRotation={false}
        pixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
      />
    </div>
  );
}