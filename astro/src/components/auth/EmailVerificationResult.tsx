import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../hooks/domains/useAuth';

type VerifyStatus = 'loading' | 'success' | 'error' | 'already_verified';

/**
 * 状态外框：成功 emerald 细线、失败 `--sf-danger` 细线、
 * 进行中/已验证走冷灰结构线；内部图标与标题沿用同一语义色，深浅主题均有令牌兜底。
 */
const PANEL_TONE: Record<VerifyStatus, string> = {
  loading: 'border-[var(--sf-line)]',
  success: 'border-emerald-300 dark:border-emerald-900/60',
  already_verified: 'border-[var(--sf-line-strong)]',
  error: 'border-[var(--sf-danger)]',
};

export default function EmailVerificationResult() {
  const [status, setStatus] = useState<VerifyStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const { confirmVerification } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage('缺少验证令牌');
      return;
    }

    confirmVerification(token)
      .then((success) => {
        if (success) {
          setStatus('success');
        } else {
          setStatus('error');
          setErrorMessage('验证失败，请重新发送验证邮件');
        }
      })
      .catch((err) => {
        const msg = err?.response?.data?.message || err?.message || '';
        if (msg.includes('already') || msg.includes('已验证')) {
          setStatus('already_verified');
        } else {
          setStatus('error');
          setErrorMessage(msg || '验证失败，请重新发送验证邮件');
        }
      });
  }, [confirmVerification]);

  // Auto-redirect after success
  useEffect(() => {
    if (status === 'success' || status === 'already_verified') {
      const timer = setTimeout(() => {
        window.location.href = '/';
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const iconVariants = {
    hidden: { scale: 0, rotate: -180 },
    visible: { scale: 1, rotate: 0, transition: { type: 'spring' as const, stiffness: 200, damping: 15 } },
  };

  return (
    <div className="flex min-h-[60svh] items-center justify-center px-4">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className={`w-full max-w-md rounded-[3px] border bg-[var(--sf-surface)] p-8 text-center ${PANEL_TONE[status]}`}
      >
        {status === 'loading' && (
          <>
            <div
              className="mx-auto mb-4 h-10 w-10 animate-spin rounded-[2px] border-2 border-[var(--sf-line)] border-t-[var(--sf-accent)]"
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold text-[var(--sf-ink)]">正在验证邮箱...</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <motion.div
              variants={iconVariants}
              initial="hidden"
              animate="visible"
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[3px] border border-emerald-300 dark:border-emerald-900/60"
            >
              <svg className="h-8 w-8 text-emerald-700 dark:text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
            <h2 className="text-xl font-semibold text-emerald-800 dark:text-emerald-200">邮箱验证成功！</h2>
            <p className="mt-2 text-sm text-[var(--sf-ink-3)]">3 秒后自动跳转首页...</p>
          </>
        )}

        {status === 'already_verified' && (
          <>
            <motion.div
              variants={iconVariants}
              initial="hidden"
              animate="visible"
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[3px] border border-[var(--sf-line-strong)]"
            >
              <svg className="h-8 w-8 text-[var(--sf-ink-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </motion.div>
            <h2 className="text-xl font-semibold text-[var(--sf-ink)]">邮箱已验证</h2>
            <p className="mt-2 text-sm text-[var(--sf-ink-3)]">3 秒后自动跳转首页...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[3px] border border-[var(--sf-danger)]">
              <svg className="h-8 w-8 text-[var(--sf-danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-[var(--sf-danger)]">验证失败</h2>
            <p className="mt-2 text-sm text-[var(--sf-ink-2)]">{errorMessage}</p>
            <a
              href="/login"
              className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-on-accent)] no-underline transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]"
            >
              返回登录
            </a>
          </>
        )}
      </motion.div>
    </div>
  );
}
