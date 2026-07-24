import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { requestVerification } from '../../lib/blog-auth-client';
import type { User } from '../../types/pocketbase';

interface AdminEmailVerificationRequiredProps {
  user: User;
  onReturnToLogin: () => void;
}

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
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
        <svg className="h-8 w-8 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>

      <div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">请先验证邮箱</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          管理员账户必须完成邮箱验证才能进入后台。
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          验证邮件已发送至 <span className="font-medium text-zinc-700 dark:text-zinc-300">{user.email}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {status === 'sent' ? (
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            验证邮件已重新发送，请检查收件箱
          </p>
        ) : status === 'error' ? (
          <p className="text-sm text-red-600 dark:text-red-400">发送失败，请稍后重试</p>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={status === 'sending'}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
          >
            {status === 'sending' ? '正在发送...' : '重新发送验证邮件'}
          </button>
        )}
        <button
          type="button"
          onClick={onReturnToLogin}
          className="focus-ring inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          返回登录
        </button>
      </div>
    </motion.div>
  );
}
