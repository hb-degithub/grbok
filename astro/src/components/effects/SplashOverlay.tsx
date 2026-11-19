import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import useBreakpoint from '../../hooks/useBreakpoint';

const STORAGE_KEY = 'blog-splash-seen';
/** 轻场景停留时间；到点自动消失，不等待任何交互。 */
const VISIBLE_MS = 1600;

function hasSeenSplash(): boolean {
  try {
    return !!window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function markSplashSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, Date.now().toString());
  } catch {
    /* ignore */
  }
}

/**
 * 展示页启动条（轻场景）。
 *
 * 旧实现是全屏不透明遮罩 + 背景滚动锁，并在同一时刻与 WelcomeOverlay 叠加成
 * 「双层阻断」。现在改为一条不拦截点击、不锁滚动、不覆盖正文的状态条：
 * - `pointer-events-none`，不参与命中测试，不挡住 CTA；
 * - 不修改 `document.body.style.overflow`；
 * - 1.6s 后自动消失并写入 `blog-splash-seen`，只在本机首次访问展示一次；
 * - `prefers-reduced-motion: reduce` 时直接标记已看过、不渲染任何动画；
 * - 仍保留 `role="status"` + `aria-label="页面加载中"` 的语义（验收夹具据此等待它退场）。
 *
 * 只在 BaseLayout 的展示页分支挂载。
 */
export default function SplashOverlay() {
  const [visible, setVisible] = useState(false);
  const { prefersReducedMotion } = useBreakpoint();

  useEffect(() => {
    if (prefersReducedMotion) {
      // 减少动效：不展示启动条，直接视为已看过。
      // 必须显式收起：若偏好是在启动条已经显示后才切换为 reduce，只 return 会把
      // 状态条永久留在页面上（旧 timer 已被本次 effect 的 cleanup 清掉）。
      markSplashSeen();
      setVisible(false);
      return;
    }
    if (hasSeenSplash()) return;

    setVisible(true);
    const timer = window.setTimeout(() => {
      markSplashSeen();
      setVisible(false);
    }, VISIBLE_MS);

    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion]);

  if (!visible) return null;

  return (
    <motion.div
      role="status"
      aria-label="页面加载中"
      data-splash-overlay="true"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-50 w-[13.5rem] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2"
    >
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
        BOOT / 轨道日志
      </p>
      <p className="mt-1 font-mono text-[0.6875rem] leading-relaxed tracking-[0.04em] text-[var(--sf-ink-2)]">
        正在装载首页场景
        <span aria-hidden="true" className="ml-1 inline-block h-1 w-1 animate-pulse bg-[var(--sf-accent)] align-middle" />
      </p>
      <span aria-hidden="true" className="mt-2 block h-px w-full overflow-hidden bg-[var(--sf-line-soft)]">
        <span className="block h-px w-1/2 bg-[var(--sf-accent)]" />
      </span>
    </motion.div>
  );
}
