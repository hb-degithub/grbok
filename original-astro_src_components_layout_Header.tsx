import React, { useState, useEffect, useRef } from 'react';
import { motion, useScroll, useMotionValueEvent } from 'framer-motion';
import { cn } from '../../lib/utils';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/posts', label: '文章' },
  { href: '/tags', label: '标签' },
  { href: '/about', label: '关于' },
];

/**
 * 导航栏组件
 *
 * 设计决策：
 * 1. 玻璃顶栏：半透明 + backdrop-blur + 底部细边框 + 内高光，滚动时内容透过来。
 * 2. 滚动隐藏：向下滚隐藏、向上滚显示，仅用 transform 不触发重排。
 * 3. 当前页高亮：读取 location.pathname，配 aria-current="page"，
 *    视觉与语义双重标识，键盘与读屏用户可知所处位置。
 */
export default function Header() {
  const [isVisible, setIsVisible] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>('');
  const lastScrollY = useRef(0);
  const { scrollY } = useScroll();

  /** 客户端获取当前路径，用于高亮当前导航项 */
  useEffect(() => {
    setCurrentPath(window.location.pathname);
  }, []);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const currentScrollY = latest;
    const delta = currentScrollY - lastScrollY.current;

    if (currentScrollY < 80) {
      setIsVisible(true);
    } else if (delta > 5) {
      setIsVisible(false);
    } else if (delta < -5) {
      setIsVisible(true);
    }

    lastScrollY.current = currentScrollY;
  });

  /** 判断是否为当前页（兼容子路径，首页精确匹配） */
  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  return (
    <motion.header
      initial={{ y: 0 }}
      animate={{ y: isVisible ? 0 : '-100%' }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-0 z-50 border-b border-white/40 bg-white/60 backdrop-blur-xl backdrop-saturate-150 dark:border-white/5 dark:bg-zinc-950/60"
      style={{ willChange: 'transform' }}
    >
      {/* 顶部内高光，强化玻璃边缘 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15"
        aria-hidden="true"
      />

      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5" aria-label="主导航">
        {/* Logo */}
        <a
          href="/"
          className="focus-ring flex items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-zinc-900 transition-colors hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
          aria-label="返回博客首页"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm transition-transform duration-200 hover:scale-105">
            <span className="text-xs font-bold text-white">B</span>
          </div>
          <span>博客</span>
        </a>

        {/* 导航链接 */}
        <ul className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-ring relative rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                    active
                      ? 'font-medium text-indigo-600 dark:text-indigo-400'
                      : 'text-zinc-600 hover:bg-white/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100'
                  )}
                >
                  {item.label}
                  {/* 当前页底部指示条 */}
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-indigo-500 dark:bg-indigo-400"
                      aria-hidden="true"
                    />
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </motion.header>
  );
}
