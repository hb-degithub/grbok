import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Input from '../ui/Input';
import FormStatus from './FormStatus';
import PixelButton from '../ui/PixelButton';
import { confirmPasswordResetToken } from '../../lib/blog-auth-client';

type ResetStatus = 'form' | 'loading' | 'success' | 'error';

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState<ResetStatus>('form');
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [formError, setFormError] = useState('');
  const [tokenError, setTokenError] = useState('');

  const getToken = () => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') || '';
  };

  const clearError = () => {
    if (status === 'error') {
      setStatus('form');
      setErrorMessage('');
      setConfirmError('');
      setFormError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const token = getToken();
    if (!token) {
      setStatus('error');
      setTokenError('缺少重置令牌，请通过邮件中的链接访问此页面');
      return;
    }

    if (!password) {
      setStatus('error');
      setErrorMessage('请输入新密码');
      setConfirmError('');
      setFormError('');
      return;
    }
    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('密码至少需要 8 个字符');
      setConfirmError('');
      setFormError('');
      return;
    }
    if (password !== passwordConfirm) {
      setStatus('error');
      setErrorMessage('');
      setConfirmError('两次输入的密码不一致');
      setFormError('');
      return;
    }

    setStatus('loading');
    setErrorMessage('');
    setConfirmError('');
    setFormError('');

    try {
      await confirmPasswordResetToken(token, password, passwordConfirm);
      setStatus('success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || (err as Error)?.message || '';
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
        setStatus('error');
        setTokenError('重置链接已过期或无效，请重新申请密码重置邮件');
      } else {
        setStatus('error');
        setFormError(msg || '重置失败，请稍后重试');
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
        <motion.div variants={itemVariants} className="flex h-14 w-14 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-line-soft)]">
          <svg className="h-7 w-7 text-[var(--sf-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </motion.div>
        <h2 className="text-lg font-semibold text-[var(--sf-ink)]">密码已重置</h2>
        <p className="text-sm text-[var(--sf-ink-3)]">你现在可以使用新密码登录了。</p>
        <a href="/login" className="mt-2 inline-block rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-4 py-2 text-sm font-medium text-[var(--sf-on-accent)] no-underline transition-colors hover:bg-[var(--sf-accent-ink)]">
          前往登录
        </a>
      </motion.div>
    );
  }

  if (tokenError) {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[3px] border border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
          <svg className="h-7 w-7 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">链接无效</h2>
        <p className="text-sm text-[var(--sf-ink-3)]">{tokenError}</p>
        <a href="/forgot-password" className="mt-2 inline-block rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 py-2 text-sm font-medium text-[var(--sf-ink-2)] no-underline transition-colors hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]">
          重新申请重置邮件
        </a>
      </motion.div>
    );
  }

  return (
    <motion.form onSubmit={handleSubmit} variants={containerVariants} initial="hidden" animate="visible" className="space-y-4" noValidate>
      <motion.div variants={itemVariants}>
        <p className="mb-3 text-sm text-[var(--sf-ink-3)]">
          输入新密码以完成重置。重置链接只能使用一次。
        </p>
      </motion.div>
      <motion.div variants={itemVariants}>
        <Input
          label="新密码"
          type="password"
          placeholder="输入新密码"
          value={password}
          onChange={(e) => { setPassword(e.target.value); clearError(); }}
          error={errorMessage || undefined}
          required
          autoComplete="new-password"
        />
      </motion.div>
      <motion.div variants={itemVariants}>
        <Input
          label="确认新密码"
          type="password"
          placeholder="再次输入新密码"
          value={passwordConfirm}
          onChange={(e) => { setPasswordConfirm(e.target.value); clearError(); }}
          error={confirmError || undefined}
          required
          autoComplete="new-password"
        />
      </motion.div>
      <motion.div variants={itemVariants}>
        <FormStatus message={formError} />
      </motion.div>
      <motion.div variants={itemVariants}>
        <PixelButton type="submit" loading={status === 'loading'} variant="primary">
          {status === 'loading' ? '重置中...' : '重置密码'}
        </PixelButton>
      </motion.div>
    </motion.form>
  );
}