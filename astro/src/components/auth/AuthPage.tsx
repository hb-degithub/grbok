import React, { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';
import PasswordLoginForm from './PasswordLoginForm';
import RegisterForm from './RegisterForm';
import LoginGridScanBackground from '../effects/LoginGridScanBackground';

type AuthMode = 'password' | 'otp' | 'register';

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('password');

  const pageVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.6, ease: 'easeOut', staggerChildren: 0.12 } },
  };

  const childVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };

  const tabClass = (tab: AuthMode) =>
    cn(
      'focus-ring relative z-10 flex min-h-[40px] flex-1 items-center justify-center rounded-xl px-1.5 text-center text-[13px] font-semibold leading-tight no-underline transition-colors duration-200 sm:min-h-11 sm:px-2 sm:text-sm',
      mode === tab
        ? 'text-zinc-950 dark:text-zinc-50'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    );

  return (
    <motion.section
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="mobile-auth-shell relative flex min-h-[var(--content-vvh,calc(100dvh-4rem))] min-h-[calc(100svh-4rem)] min-w-0 items-center justify-center overflow-hidden px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-8 md:py-12 lg:py-16"
      aria-labelledby="auth-heading"
    >
      <LoginGridScanBackground />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="pointer-events-none absolute bottom-6 left-1/2 z-[1] -translate-x-1/2 select-none text-center sm:bottom-8"
        aria-hidden="true"
      >
        <span className="auth-scan-hint inline-flex items-center gap-2 text-sm font-medium tracking-wider sm:text-base text-zinc-500 dark:text-zinc-400">
          <span className="auth-scan-dot h-1.5 w-1.5 rounded-full bg-sky-400 dark:bg-cyan-400" />
          正在扫描用户
        </span>
      </motion.div>

      <div className="relative z-10 w-full max-w-[min(100%,28rem)]">
        <motion.div variants={childVariants} className="auth-form-panel relative overflow-hidden rounded-2xl border border-white/60 bg-white/85 p-4 shadow-2xl shadow-slate-950/10 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/80 dark:shadow-black/40 sm:p-6 md:rounded-3xl md:p-8">
          <motion.div variants={childVariants} className="relative mb-5 text-center sm:mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.25 }}
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 shadow-lg shadow-sky-500/30 sm:mb-5 sm:h-16 sm:w-16 sm:rounded-lg dark:from-cyan-400 dark:to-cyan-600 dark:shadow-cyan-500/30"
              aria-hidden="true"
            >
              <span className="text-xl font-bold text-white sm:text-2xl">B</span>
            </motion.div>
            <h1 id="auth-heading" className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-xl">欢迎来到博客</h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 sm:mt-1.5 sm:text-sm">分享技术、思考与生活</p>
          </motion.div>

          <motion.div
            variants={childVariants}
            className="relative mb-4 grid grid-cols-3 rounded-xl border border-white/40 bg-white/30 p-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 sm:mb-6"
            role="tablist"
            aria-label="认证方式"
          >
            <motion.div
              className="absolute bottom-1 top-1 rounded-lg bg-white/80 shadow-sm ring-1 ring-white/60 dark:bg-white/15 dark:ring-white/10"
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
            <motion.p variants={childVariants} className="mt-3 break-words text-center text-xs leading-snug text-zinc-400 dark:text-zinc-500 sm:mt-4">
              需要配置 PocketBase 邮件服务后才能使用验证码登录
            </motion.p>
          )}
        </motion.div>

        <motion.p variants={childVariants} className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400 sm:mt-6">
          <a href="/" className="focus-ring inline-flex min-h-[40px] flex-wrap items-center justify-center gap-1.5 rounded-md px-2 font-medium leading-snug text-zinc-600 no-underline hover:text-zinc-600 dark:text-zinc-300 dark:hover:text-zinc-400">
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