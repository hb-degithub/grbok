import React, { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';
import PasswordLoginForm from './PasswordLoginForm';
import RegisterForm from './RegisterForm';

type AuthMode = 'password' | 'otp' | 'register';

const tabs: Array<{ id: AuthMode; label: string }> = [
  { id: 'password', label: '密码登录' },
  { id: 'otp', label: '验证码' },
  { id: 'register', label: '注册' },
];

/** 冷灰细网格：与全站一致，不使用 WebGL/扫描光带。 */
const gridStyle = {
  backgroundImage:
    'linear-gradient(to right, var(--sf-line-soft) 1px, transparent 1px), linear-gradient(to bottom, var(--sf-line-soft) 1px, transparent 1px)',
  backgroundSize: '32px 32px',
} as const;

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

  const tabIndex = tabs.findIndex((tab) => tab.id === mode);
  const tabWidth = 100 / tabs.length;

  const tabClass = (tab: AuthMode) =>
    cn(
      'focus-ring relative z-10 flex min-h-[40px] flex-1 items-center justify-center rounded-[2px] px-1.5 text-center text-[13px] font-medium leading-tight no-underline transition-colors duration-200 sm:min-h-11 sm:px-2 sm:text-sm',
      mode === tab ? 'text-[var(--sf-ink)]' : 'text-[var(--sf-ink-3)] hover:text-[var(--sf-ink-2)]'
    );

  return (
    <motion.section
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="mobile-auth-shell relative flex min-h-[var(--content-vvh,calc(100dvh-4rem))] min-h-[calc(100svh-4rem)] min-w-0 items-center justify-center overflow-hidden bg-[var(--sf-canvas)] px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-8 md:py-12 lg:py-16"
      aria-labelledby="auth-heading"
    >
      <div className="pointer-events-none absolute inset-0" style={gridStyle} aria-hidden="true" />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="pointer-events-none absolute bottom-6 left-1/2 z-[1] -translate-x-1/2 select-none text-center sm:bottom-8"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-2 border border-[var(--sf-line)] bg-[var(--sf-surface)] px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--sf-accent)]" />
          正在扫描用户
        </span>
      </motion.div>

      <div className="relative z-10 w-full max-w-[min(100%,28rem)]">
        <motion.div variants={childVariants} className="relative overflow-hidden rounded-[4px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 sm:p-6 md:rounded-[6px] md:p-8">
          <span className="pointer-events-none absolute left-2 top-2 h-2 w-2 border-l border-t border-[var(--sf-line-strong)]" aria-hidden="true" />
          <span className="pointer-events-none absolute right-2 top-2 h-2 w-2 border-r border-t border-[var(--sf-line-strong)]" aria-hidden="true" />

          <motion.div variants={childVariants} className="relative mb-5 text-center sm:mb-7">
            <div
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[3px] border border-[var(--sf-line-strong)] bg-[var(--sf-accent)] sm:mb-4 sm:h-14 sm:w-14"
              aria-hidden="true"
            >
              <span className="font-mono text-lg font-bold text-[var(--sf-canvas)] sm:text-xl">B</span>
            </div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--sf-ink-3)]">Secure Access / 身份验证</div>
            <h1 id="auth-heading" className="text-lg font-semibold tracking-tight text-[var(--sf-ink)] sm:text-xl">欢迎来到博客</h1>
            <p className="mt-1 text-xs text-[var(--sf-ink-3)] sm:mt-1.5 sm:text-sm">分享技术、思考与生活</p>
          </motion.div>

          <motion.div
            variants={childVariants}
            className="relative mb-4 grid grid-cols-3 border border-[var(--sf-line)] bg-[var(--sf-canvas)] sm:mb-6"
            role="tablist"
            aria-label="认证方式"
          >
            <motion.span
              className="absolute bottom-0 h-[2px] bg-[var(--sf-accent)]"
              animate={{ left: `${tabIndex * tabWidth}%`, width: `${tabWidth}%` }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
            />
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => setMode(tab.id)}
                className={tabClass(tab.id)}
              >
                {tab.label}
              </button>
            ))}
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
            <motion.p variants={childVariants} className="mt-3 break-words text-center text-xs leading-snug text-[var(--sf-ink-3)] sm:mt-4">
              需要配置 PocketBase 邮件服务后才能使用验证码登录
            </motion.p>
          )}
        </motion.div>

        <motion.p variants={childVariants} className="mt-4 text-center sm:mt-6">
          <a href="/" className="focus-ring inline-flex min-h-[40px] flex-wrap items-center justify-center gap-1.5 rounded-[2px] px-2 text-xs text-[var(--sf-ink-3)] no-underline transition-colors hover:text-[var(--sf-accent-ink)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 19l-7-7 7-7" />
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
