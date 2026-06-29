import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';
import PasswordLoginForm from './PasswordLoginForm';
import RegisterForm from './RegisterForm';

type AuthMode = 'password' | 'otp' | 'register';

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('password');

  const pageVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.6, ease: 'easeOut', staggerChildren: 0.12 } },
  };

  const childVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };

  const tabClass = (tab: AuthMode) =>
    cn(
      'focus-ring relative z-10 flex min-h-[40px] flex-1 items-center justify-center rounded-xl px-1.5 text-center text-[13px] font-semibold leading-tight no-underline transition-colors duration-200 sm:min-h-11 sm:px-2 sm:text-sm',
      mode === tab
        ? 'text-stone-950 dark:text-stone-50'
        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
    );

  return (
    <motion.section
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="relative flex min-h-[calc(var(--vvh,100dvh)-var(--header-h,4rem))] min-w-0 items-start justify-center overflow-x-clip px-3 py-4 sm:px-4 sm:py-8 md:items-center md:py-12 lg:py-16"
      aria-labelledby="auth-heading"
    >
      <div className="aurora" aria-hidden="true">
        <div className="aurora__blob aurora__blob--indigo h-[min(24rem,70vw)] w-[min(24rem,70vw)] -left-20 top-0" />
        <div className="aurora__blob aurora__blob--violet h-[min(28rem,78vw)] w-[min(28rem,78vw)] right-0 top-1/4" />
        <div className="aurora__blob aurora__blob--sky h-[min(22rem,65vw)] w-[min(22rem,65vw)] bottom-0 left-1/3" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(99 102 241) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="relative z-10 w-full max-w-[min(100%,28rem)]">
        <motion.div variants={childVariants} className="glass-strong relative overflow-hidden rounded-2xl p-4 sm:rounded-3xl sm:p-8 md:p-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/20" aria-hidden="true" />

          <motion.div variants={childVariants} className="relative mb-5 text-center sm:mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.25 }}
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-stone-600 to-stone-700 shadow-lg shadow-stone-600/30 sm:mb-5 sm:h-16 sm:w-16 sm:rounded-2xl"
              aria-hidden="true"
            >
              <span className="text-xl font-bold text-white sm:text-2xl">B</span>
            </motion.div>
            <h1 id="auth-heading" className="text-lg font-semibold tracking-tight text-stone-900 dark:text-white sm:text-xl">欢迎来到博客</h1>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 sm:mt-1.5 sm:text-sm">分享技术、思考与生活</p>
          </motion.div>

          <motion.div
            variants={childVariants}
            className="relative mb-4 grid grid-cols-3 rounded-2xl border border-stone-200 bg-stone-50 p-1 shadow-inner shadow-stone-900/[0.03] dark:border-stone-700 dark:bg-stone-900 sm:mb-6"
            role="tablist"
            aria-label="认证方式"
          >
            <motion.div
              className="absolute bottom-1 top-1 rounded-xl bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700"
              animate={{
                left: mode === 'password' ? 4 : mode === 'otp' ? '33.333333%' : '66.666667%',
                right: mode === 'password' ? '66.666667%' : mode === 'otp' ? '33.333333%' : 4,
              }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
            />
            <button type="button" role="tab" aria-selected={mode === 'password'} onClick={() => setMode('password')} className={tabClass('password')}>
              密码登录
            </button>
            <button type="button" role="tab" aria-selected={mode === 'otp'} onClick={() => setMode('otp')} className={tabClass('otp')}>
              验证码
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')} className={tabClass('register')}>
              注册
            </button>
          </motion.div>

          <AnimatePresence mode="wait">
            {mode === 'otp' ? (
              <MagicLinkForm key="otp" />
            ) : mode === 'register' ? (
              <RegisterForm key="register" />
            ) : (
              <PasswordLoginForm key="password" />
            )}
          </AnimatePresence>

          {mode === 'otp' && (
            <motion.p variants={childVariants} className="mt-3 break-words text-center text-xs leading-snug text-stone-400 dark:text-stone-500 sm:mt-4">
              需要配置 PocketBase 邮件服务后才能使用验证码登录
            </motion.p>
          )}
        </motion.div>

        <motion.p variants={childVariants} className="mt-4 text-center text-sm text-stone-500 dark:text-stone-400 sm:mt-6">
          <a href="/" className="focus-ring inline-flex min-h-[40px] flex-wrap items-center justify-center gap-1.5 rounded-md px-2 font-medium leading-snug text-stone-600 no-underline hover:text-stone-600 dark:text-stone-300 dark:hover:text-stone-400">
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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
