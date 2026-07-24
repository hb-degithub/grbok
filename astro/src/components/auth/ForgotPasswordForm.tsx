import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Input from '../ui/Input';
import PixelButton from '../ui/PixelButton';
import { requestPasswordReset, isAccountMailRateLimited, type AccountMailResponse } from '../../lib/blog-auth-client';
import { RateLimiter } from '../../lib/security';

const forgotLimiter = new RateLimiter(3, 0.15);

type ForgotStatus = 'idle' | 'loading' | 'success' | 'error';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<ForgotStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [referenceId, setReferenceId] = useState('');

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const clearError = () => {
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus('error');
      setErrorMessage('请输入邮箱地址');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setStatus('error');
      setErrorMessage('邮箱格式不正确');
      return;
    }
    if (!forgotLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    setErrorMessage('');
    setReferenceId('');

    try {
      const response: AccountMailResponse = await requestPasswordReset(trimmedEmail);
      if (isAccountMailRateLimited(response)) {
        setStatus('error');
        const retry = response.retryAfterSeconds ? `，请 ${response.retryAfterSeconds} 秒后重试` : '';
        setErrorMessage(`请求过于频繁${retry}`);
        if (response.referenceId) setReferenceId(response.referenceId);
        return;
      }
      setStatus('success');
      if (response.referenceId) setReferenceId(response.referenceId);
    } catch {
      setStatus('error');
      setErrorMessage('请求失败，请稍后重试');
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

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" exit="exit">
      {status === 'success' ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30">
            <svg className="h-7 w-7 text-sky-600 dark:text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">重置邮件已发送</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            如果该邮箱已注册，你将收到一封密码重置邮件。请检查收件箱和垃圾邮件文件夹。
          </p>
          {referenceId && (
            <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">参考号：{referenceId}</p>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">为保护账户安全，无论邮箱是否存在都会返回相同提示。</p>
          <a href="/login" className="mt-2 inline-block rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 no-underline transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600">
            返回登录
          </a>
        </motion.div>
      ) : (
        <motion.form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <motion.div variants={itemVariants}>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              输入注册邮箱，我们将向其发送密码重置链接。链接有效期为 24 小时。
            </p>
          </motion.div>
          <motion.div variants={itemVariants}>
            <Input
              label="邮箱"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError(); }}
              error={status === 'error' ? errorMessage : undefined}
              required
              autoComplete="email"
            />
          </motion.div>
          {status === 'error' && referenceId && (
            <motion.p variants={itemVariants} className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
              参考号：{referenceId}
            </motion.p>
          )}
          <motion.div variants={itemVariants}>
            <PixelButton type="submit" loading={status === 'loading'} variant="primary">
              {status === 'loading' ? '发送中...' : '发送重置邮件'}
            </PixelButton>
          </motion.div>
          <motion.div variants={itemVariants} className="text-center">
            <a href="/login" className="text-sm text-zinc-500 no-underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
              返回登录
            </a>
          </motion.div>
        </motion.form>
      )}
    </motion.div>
  );
}