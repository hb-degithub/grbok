import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { requestVerification } from '../../lib/blog-auth-client';
import type { User } from '../../types/pocketbase';

interface AdminEmailVerificationRequiredProps {
  user: User;
  onReturnToLogin: () => void;
}

/**
 * 管理员邮箱验证闸门：细线图标框 + 强调色实底主按钮。
 * 状态机（idle / sending / sent / error）与重发请求保持原样，只替换视觉令牌。
 */
export default function AdminEmailVerificationRequired({ user, onReturnToLogin }: AdminEmailVerificationRequiredProps) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const handleResend = useCallback(async () => {
    setStatus('sending');
    try {
      await requestVerification(user.email);
      setStatus('sent');
    } catch (err) {
      console.error('Resend admin verification failed:', err);
      setStatus('error');
    }
  }, [user.email]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-[3px] border border-amber-500/60 bg-amber-500/5 dark:border-amber-400/50">
        <svg className="h-8 w-8 text-amber-700 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--sf-ink)]">请先验证邮箱</h2>
        <p className="mt-2 text-sm text-[var(--sf-ink-2)]">
          管理员账户必须完成邮箱验证才能进入后台。
        </p>
        <p className="mt-1 text-sm text-[var(--sf-ink-2)]">
          验证邮件已发送至 <span className="font-medium text-[var(--sf-ink)]">{user.email}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {status === 'sent' ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            验证邮件已重新发送，请检查收件箱
          </p>
        ) : status === 'error' ? (
          <p className="text-sm text-[var(--sf-danger)]">发送失败，请稍后重试</p>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={status === 'sending'}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-4 py-2 text-sm font-medium text-[var(--sf-on-accent)] transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)] disabled:opacity-50"
          >
            {status === 'sending' ? '正在发送...' : '重新发送验证邮件'}
          </button>
        )}
        <button
          type="button"
          onClick={onReturnToLogin}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-[3px] border border-[var(--sf-line-control)] px-4 py-2 text-sm font-medium text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
        >
          返回登录
        </button>
      </div>
    </motion.div>
  );
}
