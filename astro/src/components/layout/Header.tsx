import React, { useState, useRef } from 'react';
import { motion, useScroll, useMotionValueEvent } from 'framer-motion';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/posts', label: '文章' },
  { href: '/tags', label: '标签' },
  { href: '/about', label: '关于' },
];

/**
 * 导航栏组件
 * 滚动时自动隐藏/显示，带磨砂玻璃背景
 */
export default function Header() {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { scrollY } = useScroll();

  /**
   * 使用 useMotionValueEvent 监听滚动
   * 仅使用 transform，不触发重排
   */
  useMotionValueEvent(scrollY, 'change', (latest) => {
    const currentScrollY = latest;
    const delta = currentScrollY - lastScrollY.current;

    // 向下滚动超过 80px 时隐藏，向上滚动时显示
    if (currentScrollY < 80) {
      setIsVisible(true);
    } else if (delta > 5) {
      setIsVisible(false);
    } else if (delta < -5) {
      setIsVisible(true);
    }

    lastScrollY.current = currentScrollY;
  });

  return (
    <motion.header
      initial={{ y: 0 }}
      animate={{ y: isVisible ? 0 : '-100%' }}
      transition={{
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1], // Ease-Out-Expo
      }}
      className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200/80 bg-white/70 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/70"
      style={{ willChange: 'transform' }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        {/* Logo */}
        <a
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 transition-transform duration-200 hover:scale-105 dark:bg-zinc-100">
            <span className="text-xs font-bold text-white dark:text-zinc-900">B</span>
          </div>
          <span>博客</span>
        </a>

        {/* 导航链接 */}
        <ul className="flex items-center gap-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="relative rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </motion.header>
  );
}
