import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';
import PasswordLoginForm from './PasswordLoginForm';

type AuthMode = 'magic-link' | 'password';

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('password');

  const pageVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.6, ease: 'easeOut', staggerChildren: 0.12 } },
  };

  const childVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };

  return (
    <motion.section
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="relative -mx-6 -mt-16 flex min-h-[88vh] items-center justify-center overflow-hidden px-4 py-20 sm:-mx-6"
      aria-labelledby="auth-heading"
    >
      <div className="aurora" aria-hidden="true">
        <div className="aurora__blob aurora__blob--indigo h-[420px] w-[420px] -left-20 top-0" />
        <div className="aurora__blob aurora__blob--violet h-[480px] w-[480px] right-0 top-1/4" />
        <div className="aurora__blob aurora__blob--sky h-[380px] w-[380px] bottom-0 left-1/3" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(99 102 241) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <motion.div variants={childVariants} className="glass-strong relative overflow-hidden rounded-3xl p-8 sm:p-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/20" aria-hidden="true" />

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
            <h1 id="auth-heading" className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">欢迎来到博客</h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">分享技术、思考与生活</p>
          </motion.div>

          {/* 登录方式切换 */}
          <motion.div variants={childVariants} className="mb-6 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
            <button
              onClick={() => setMode('password')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${mode === 'password' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              密码登录
            </button>
            <button
              onClick={() => setMode('magic-link')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${mode === 'magic-link' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              邮箱验证码
            </button>
          </motion.div>

          <AnimatePresence mode="wait">
            {mode === 'magic-link' ? (
              <MagicLinkForm key="magic-link" />
            ) : (
              <PasswordLoginForm key="password" />
            )}
          </AnimatePresence>

          {mode === 'magic-link' && (
            <motion.p variants={childVariants} className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
              需要配置 SMTP 邮件服务才能使用
            </motion.p>
          )}
        </motion.div>

        <motion.p variants={childVariants} className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <a href="/" className="link-underline focus-ring inline-flex items-center gap-1.5 rounded-md font-medium text-zinc-600 hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400">
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
