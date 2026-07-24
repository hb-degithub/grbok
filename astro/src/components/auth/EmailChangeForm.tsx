function maskEmailLocal(email: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Input from '../ui/Input';
import PixelButton from '../ui/PixelButton';
import { requestEmailChange, isAccountMailRateLimited, type AccountMailResponse } from '../../lib/blog-auth-client';
import { RateLimiter } from '../../lib/security';
import { useAuthStatus, getUserDisplayName } from '../../hooks/useAuthStatus';

const emailChangeLimiter = new RateLimiter(3, 0.15);

type EmailChangeStatus = 'idle' | 'loading' | 'success' | 'error';

export default function EmailChangeForm() {
  const { user } = useAuthStatus();
  const [newEmail, setNewEmail] = useState('');
  const [status, setStatus] = useState<EmailChangeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [referenceId, setReferenceId] = useState('');

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const currentEmail = user?.email || '';
  const currentMasked = maskEmailLocal(currentEmail);

  const clearError = () => {
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) {
      setStatus('error');
      setErrorMessage('请输入新邮箱地址');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setStatus('error');
      setErrorMessage('邮箱格式不正确');
      return;
    }
    if (trimmedEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setStatus('error');
      setErrorMessage('新邮箱不能与当前邮箱相同');
      return;
    }
    if (!emailChangeLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    setErrorMessage('');
    setReferenceId('');

    try {
      const response: AccountMailResponse = await requestEmailChange(trimmedEmail);
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

  if (!user) {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col items-center gap-3 py-6 text-center">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">请先登录</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">邮箱变更需要先登录账户。</p>
        <a href="/login" className="mt-2 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white no-underline transition-colors hover:bg-indigo-700">
          前往登录
        </a>
      </motion.div>
    );
  }

  if (status === 'success') {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30">
          <svg className="h-7 w-7 text-sky-600 dark:text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">确认邮件已发送</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          我们已向新邮箱发送了一封确认邮件。请前往新邮箱查收并点击确认链接以完成变更。
        </p>
        {referenceId && (
          <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">参考号：{referenceId}</p>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">确认前，当前邮箱仍可正常用于登录。</p>
        <a href="/" className="mt-2 inline-block rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 no-underline transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600">
          返回首页
        </a>
      </motion.div>
    );
  }

  return (
    <motion.form onSubmit={handleSubmit} variants={containerVariants} initial="hidden" animate="visible" className="space-y-4" noValidate>
      <motion.div variants={itemVariants}>
        <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">
          当前用户：{getUserDisplayName(user)}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          当前邮箱：{currentMasked}
        </p>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          输入新邮箱地址，我们将向其发送确认链接。变更将在新邮箱确认后生效。
        </p>
      </motion.div>
      <motion.div variants={itemVariants}>
        <Input
          label="新邮箱"
          type="email"
          placeholder="new@email.com"
          value={newEmail}
          onChange={(e) => { setNewEmail(e.target.value); clearError(); }}
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
          {status === 'loading' ? '发送中...' : '发送确认邮件'}
        </PixelButton>
      </motion.div>
      <motion.div variants={itemVariants} className="text-center">
        <a href="/" className="text-sm text-zinc-500 no-underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
          返回首页
        </a>
      </motion.div>
    </motion.form>
  );
}