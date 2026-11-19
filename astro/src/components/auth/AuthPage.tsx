import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AuthTabs, { authPanelId, authTabId } from './AuthTabs';
import MagicLinkForm from './MagicLinkForm';
import PasswordLoginForm from './PasswordLoginForm';
import RegisterForm from './RegisterForm';

type AuthMode = 'password' | 'otp' | 'register';

const tabs: ReadonlyArray<{ id: AuthMode; label: string }> = [
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

/**
 * 登录页表单区：只负责右侧卡片内容，左侧品牌/流程说明由 AuthShell（Astro）渲染。
 *
 * tab 行为已抽到共享 AuthTabs：roving tabindex、方向键/Home/End、
 * aria-controls/tabpanel。三个子表单与提交逻辑保持不变。
 */
export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('password');

  return (
    <section aria-labelledby="auth-heading" className="relative min-w-0">
      <div className="pointer-events-none absolute inset-0" style={gridStyle} aria-hidden="true" />

      <div className="relative">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--sf-ink-3)]">
            Secure Access / 身份验证
          </p>
          <h1 id="auth-heading" className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--sf-ink)] sm:text-2xl">
            欢迎来到博客
          </h1>
          <p className="mt-1 text-sm leading-snug text-[var(--sf-ink-3)]">分享技术、思考与生活</p>
        </motion.header>

        <AuthTabs
          items={tabs}
          value={mode}
          onChange={setMode}
          idPrefix="auth"
          ariaLabel="认证方式"
          className="mt-5 sm:mt-6"
        />

        {tabs.map((tab) => {
          const selected = tab.id === mode;
          const tabPanelId = authPanelId(tab.id);
          const tabLabelId = authTabId(tab.id);

          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={tabPanelId}
              aria-labelledby={tabLabelId}
              tabIndex={0}
              hidden={!selected}
              className="focus-ring mt-4 rounded-[2px] sm:mt-5"
            >
              {selected && (
                <AnimatePresence mode="wait">
                  {tab.id === 'otp' ? (
                    <MagicLinkForm key="otp" />
                  ) : tab.id === 'register' ? (
                    <RegisterForm key="register" />
                  ) : (
                    <PasswordLoginForm key="password" />
                  )}
                </AnimatePresence>
              )}

              {selected && tab.id === 'otp' && (
                <p className="mt-3 break-words text-center text-xs leading-snug text-[var(--sf-ink-3)] sm:mt-4">
                  需要配置 PocketBase 邮件服务后才能使用验证码登录
                </p>
              )}
            </div>
          );
        })}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--sf-line-soft)] pt-3">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sf-accent)]" />
            正在扫描用户
          </span>
          <a
            href="/"
            className="focus-ring inline-flex min-h-[40px] flex-wrap items-center justify-center gap-1.5 rounded-[2px] px-2 text-xs text-[var(--sf-ink-3)] no-underline transition-colors hover:text-[var(--sf-accent-ink)]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 19l-7-7 7-7" />
            </svg>
            返回首页
          </a>
        </div>
      </div>
    </section>
  );
}
