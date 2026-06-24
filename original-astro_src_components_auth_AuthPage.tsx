import React from 'react';
import { motion } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';

/**
 * 认证页面主组件
 *
 * 设计决策：
 * 1. 全屏 aurora 动态光晕作为背景层，让毛玻璃卡片有内容可「透」，
 *    这是玻璃拟态成立的前提——纯色背景上看不出模糊效果。
 * 2. 登录卡使用 glass-strong（更高不透明度），保证表单文字 WCAG AA 对比度。
 * 3. 入场动画用 staggerChildren 交错，强化「层次感」而非一次性闪现。
 * 4. 装饰性 Logo 用 aria-hidden，避免屏幕阅读器念出无意义字母。
 */
export default function AuthPage() {
  /** 页面容器入场：先整体淡入，再交错触发子元素 */
  const pageVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.6,
        ease: 'easeOut',
        staggerChildren: 0.12,
      },
    },
  };

  /** 子元素入场：从下方上浮 + 淡入，缓动 easeOut 避免生硬 */
  const childVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
    },
  };

  return (
    <motion.section
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      // 相对定位 + min-h 撑满，为 aurora 背景层提供定位上下文
      className="relative -mx-6 -mt-16 flex min-h-[88vh] items-center justify-center overflow-hidden px-4 py-20 sm:-mx-6"
      aria-labelledby="auth-heading"
    >
      {/* ============ Aurora 动态光晕背景层 ============ */}
      <div className="aurora" aria-hidden="true">
        <div className="aurora__blob aurora__blob--indigo h-[420px] w-[420px] -left-20 top-0" />
        <div className="aurora__blob aurora__blob--violet h-[480px] w-[480px] right-0 top-1/4" />
        <div className="aurora__blob aurora__blob--sky h-[380px] w-[380px] bottom-0 left-1/3" />
        {/* 细密网格纹理，增加质感 */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgb(99 102 241) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* ============ 玻璃登录卡 ============ */}
        <motion.div
          variants={childVariants}
          className="glass-strong relative overflow-hidden rounded-3xl p-8 sm:p-10"
        >
          {/* 卡片内顶部高光，强化「玻璃边缘」感 */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/20"
            aria-hidden="true"
          />

          {/* 品牌标识 */}
          <motion.div variants={childVariants} className="relative mb-8 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.25 }}
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30"
              aria-hidden="true"
            >
              <span className="text-2xl font-bold text-white">B</span>
            </motion.div>

            <h1
              id="auth-heading"
              className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white"
            >
              欢迎来到博客
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              分享技术、思考与生活
            </p>
          </motion.div>

          {/* Magic Link 登录表单 */}
          <motion.div variants={childVariants} className="relative">
            <MagicLinkForm />
          </motion.div>
        </motion.div>

        {/* 底部返回链接 */}
        <motion.p
          variants={childVariants}
          className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          <a
            href="/"
            className="link-underline focus-ring inline-flex items-center gap-1.5 rounded-md font-medium text-zinc-600 hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回首页
          </a>
        </motion.p>
      </div>
    </motion.section>
  );
}
