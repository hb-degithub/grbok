import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { EASE_OUT_EXPO, fadeUp, staggerContainer } from '../../lib/motion';

const NAV_ITEMS = [
  { id: 'top', href: '/', label: '首页', num: '01' },
  { id: 'latest', href: '#latest', label: '最新文章', num: '02' },
  { id: 'posts', href: '/posts', label: '全部文章', num: '03' },
  { id: 'tags', href: '/tags', label: '标签索引', num: '04' },
] as const;

type NavId = (typeof NAV_ITEMS)[number]['id'];

/**
 * 首页左侧固定导航（xl 以上显示）。
 * Scrollspy：滚动经过 #latest 后高亮「最新文章」，回到顶部高亮「首页」；
 * 当前项指示 pill 用 layoutId 在项间滑动，配合逐项 stagger 入场。
 */
export default function HomeSideNav() {
  const [active, setActive] = useState<NavId>('top');

  useEffect(() => {
    const latest = document.getElementById('latest');
    if (!latest) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const passed = window.scrollY + window.innerHeight * 0.35 >= latest.offsetTop;
      setActive(passed ? 'latest' : 'top');
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <motion.nav
        variants={staggerContainer(0.06, 0.1)}
        initial="hidden"
        animate="visible"
        aria-label="分区导航"
        className="grid gap-2 text-sm"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <motion.a
              key={item.id}
              variants={fadeUp}
              href={item.href}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className={`group relative flex items-center justify-between rounded-lg px-4 py-3 font-semibold no-underline transition-colors ${
                isActive
                  ? 'text-white dark:text-zinc-950'
                  : 'bg-zinc-50 text-zinc-700 hover:text-zinc-950 dark:bg-zinc-950/50 dark:text-zinc-300 dark:hover:text-zinc-50'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="home-side-nav-pill"
                  transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                  className="absolute inset-0 rounded-lg bg-zinc-900 dark:bg-zinc-100"
                  aria-hidden="true"
                />
              )}
              <span className="relative z-10">{item.label}</span>
              <span
                className={`relative z-10 font-mono text-xs transition-colors ${
                  isActive
                    ? 'text-teal-400 dark:text-teal-600'
                    : 'text-zinc-400 group-hover:text-teal-500 dark:group-hover:text-teal-400'
                }`}
              >
                {item.num}
              </span>
            </motion.a>
          );
        })}
      </motion.nav>
    </MotionConfig>
  );
}
