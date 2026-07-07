import { useEffect, useState, lazy, Suspense } from 'react';
import './LoginGridScanBackground.css';

// Lazy-load GridScan so the three.js + postprocessing vendor chunk (~700KB)
// streams in AFTER the login form renders. The background is decorative; the
// form is the functional content and must paint first.
const GridScan = lazy(() => import('../reactbits/GridScan').then(m => ({ default: m.GridScan })));

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

/**
 * Day theme: vibrant sky-blue scan sweeping across a soft slate grid.
 * Energetic, modern, with a clearly visible scanning band.
 */
const dayProps = {
  linesColor: '#94A3B8',
  scanColor: '#38BDF8',
  scanOpacity: 1.0,
  gridScale: 0.09,
  lineThickness: 1.2,
  lineJitter: 0.06,
  scanGlow: 1.3,
  scanSoftness: 1.4,
  scanDuration: 2.0,
  scanDelay: 0.6,
  bloomIntensity: 0.6,
  bloomThreshold: 0.04,
  bloomSmoothing: 0.18,
  chromaticAberration: 0.0012,
  noiseIntensity: 0.012,
  scanDirection: 'forward' as const,
  scanPhaseTaper: 0.85,
};

/**
 * Night theme: electric cyan scan with violet aura on a deep dark grid.
 * Dramatic, cinematic, with a strong pulsing scan and heavier bloom.
 */
const nightProps = {
  linesColor: '#334155',
  scanColor: '#22D3EE',
  scanOpacity: 1.0,
  gridScale: 0.1,
  lineThickness: 1.3,
  lineJitter: 0.1,
  scanGlow: 1.5,
  scanSoftness: 1.2,
  scanDuration: 1.6,
  scanDelay: 0.4,
  bloomIntensity: 0.85,
  bloomThreshold: 0.03,
  bloomSmoothing: 0.14,
  chromaticAberration: 0.0028,
  noiseIntensity: 0.018,
  scanDirection: 'pingpong' as const,
  scanPhaseTaper: 0.8,
};

export default function LoginGridScanBackground() {
  const theme = useResolvedTheme();
  const isDark = theme === 'dark';
  const props = isDark ? nightProps : dayProps;

  return (
    <div className={`login-gridscan-bg${isDark ? ' login-gridscan-bg--night' : ' login-gridscan-bg--day'}`} aria-hidden="true">
      <Suspense fallback={null}>
        <GridScan
          enableWebcam={false}
          showPreview={false}
          sensitivity={0.42}
          enablePost
          {...props}
        />
      </Suspense>
    </div>
  );
}