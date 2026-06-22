import React from 'react';
import { motion } from 'framer-motion';
import { MagicLinkForm } from './MagicLinkForm';

/**
 * 认证页面主组件
 * 使用 Framer Motion 实现页面加载时的平滑淡入和元素交错入场
 */
export function AuthPage() {
  /**
   * 页面动画配置
   * 定义整个页面容器的入场动画
   */
  const pageVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.6,
        ease: 'easeOut',
        staggerChildren: 0.2, // 子元素交错入场延迟
      },
    },
  };

  /**
   * 子元素动画配置
   */
  const childVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: 'easeOut',
      },
    },
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="flex min-h-[70vh] items-center justify-center px-4"
    >
      <div className="w-full max-w-md">
        {/* 卡片容器 - 玻璃拟态效果 */}
        <motion.div
          variants={childVariants}
          className="relative overflow-hidden rounded-2xl border border-gray-200/50 bg-white/80 p-8 shadow-xl backdrop-blur-sm dark:border-gray-700/50 dark:bg-gray-900/80"
        >
          {/* 装饰性背景光晕 */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-purple-500/10 blur-3xl" />

          {/* Logo 或品牌标识 */}
          <motion.div
            variants={childVariants}
            className="relative mb-8 text-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 15,
                delay: 0.3,
              }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg"
            >
              <span className="text-2xl font-bold text-white">B</span>
            </motion.div>

            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              欢迎来到博客
            </h1>
          </motion.div>

          {/* Magic Link 登录表单 */}
          <motion.div variants={childVariants} className="relative">
            <MagicLinkForm />
          </motion.div>
        </motion.div>

        {/* 底部链接 */}
        <motion.div
          variants={childVariants}
          className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          <a href="/" className="hover:text-blue-600 dark:hover:text-blue-400">
            &larr; 返回首页
          </a>
        </motion.div>
      </div>
    </motion.div>
  );
}
