import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Input from '../ui/Input';
import PixelButton from '../ui/PixelButton';
import { confirmEmailChangeToken } from '../../lib/blog-auth-client';

type ConfirmStatus = 'form' | 'loading' | 'success' | 'error';

export default function ConfirmEmailChangeForm() {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ConfirmStatus>('form');
  const [errorMessage, setErrorMessage] = useState('');
  const [tokenError, setTokenError] = useState('');

  const getToken = () => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') || '';
  };

  const clearError = () => {
    if (status === 'error') {
      setStatus('form');
      setErrorMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const token = getToken();
    if (!token) {
      setStatus('error');
      setTokenError('缺少确认令牌，请通过邮件中的链接访问此页面');
      return;
    }

    if (!password) {
      setStatus('error');
      setErrorMessage('请输入当前密码以确认变更');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      await confirmEmailChangeToken(token, password);
      setStatus('success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || (err as Error)?.message || '';
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
        setStatus('error');
        setTokenError('确认链接已过期或无效，请重新发起邮箱变更');
      } else {
        setStatus('error');
        setErrorMessage(msg || '确认失败，请稍后重试');
      }
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] as const } },
    exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
  };

  if (status === 'success') {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col items-center gap-3 py-6 text-center">
        <motion.div variants={itemVariants} className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <svg className="h-7 w-7 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </motion.div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">邮箱已变更</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">你的账户邮箱已成功更新。请使用新邮箱登录。</p>
        <a href="/login" className="mt-2 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white no-underline transition-colors hover:bg-indigo-700">
          重新登录
        </a>
      </motion.div>
    );
  }

  if (tokenError) {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <svg className="h-7 w-7 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">链接无效</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{tokenError}</p>
        <a href="/account/email-change" className="mt-2 inline-block rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 no-underline transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600">
          重新发起邮箱变更
        </a>
      </motion.div>
    );
  }

  return (
    <motion.form onSubmit={handleSubmit} variants={containerVariants} initial="hidden" animate="visible" className="space-y-4" noValidate>
      <motion.div variants={itemVariants}>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          请输入当前密码以确认邮箱变更。确认后，新邮箱将立即生效。
        </p>
      </motion.div>
      <motion.div variants={itemVariants}>
        <Input
          label="当前密码"
          type="password"
          placeholder="输入当前密码"
          value={password}
          onChange={(e) => { setPassword(e.target.value); clearError(); }}
          error={status === 'error' ? errorMessage : undefined}
          required
          autoComplete="current-password"
        />
      </motion.div>
      <motion.div variants={itemVariants}>
        <PixelButton type="submit" loading={status === 'loading'} variant="primary">
          {status === 'loading' ? '确认中...' : '确认变更邮箱'}
        </PixelButton>
      </motion.div>
    </motion.form>
  );
}