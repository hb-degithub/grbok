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
          <div className="flex h-14 w-14 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-line-soft)]">
            <svg className="h-7 w-7 text-[var(--sf-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[var(--sf-ink)]">重置邮件已发送</h2>
          <p className="text-sm leading-relaxed text-[var(--sf-ink-3)]">
            如果该邮箱已注册，你将收到一封密码重置邮件。请检查收件箱和垃圾邮件文件夹。
          </p>
          {referenceId && (
            <p className="font-mono text-xs text-[var(--sf-ink-3)]">参考号：{referenceId}</p>
          )}
          <p className="text-xs text-[var(--sf-ink-3)]">为保护账户安全，无论邮箱是否存在都会返回相同提示。</p>
          <a href="/login" className="mt-2 inline-block rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 py-2 text-sm font-medium text-[var(--sf-ink-2)] no-underline transition-colors hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]">
            返回登录
          </a>
        </motion.div>
      ) : (
        <motion.form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <motion.div variants={itemVariants}>
            <p className="mb-3 text-sm leading-relaxed text-[var(--sf-ink-3)]">
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
            <motion.p variants={itemVariants} className="font-mono text-xs text-[var(--sf-ink-3)]">
              参考号：{referenceId}
            </motion.p>
          )}
          <motion.div variants={itemVariants}>
            <PixelButton type="submit" loading={status === 'loading'} variant="primary">
              {status === 'loading' ? '发送中...' : '发送重置邮件'}
            </PixelButton>
          </motion.div>
          <motion.div variants={itemVariants} className="text-center">
            <a href="/login" className="text-sm text-[var(--sf-ink-3)] no-underline transition-colors hover:text-[var(--sf-ink)]">
              返回登录
            </a>
          </motion.div>
        </motion.form>
      )}
    </motion.div>
  );
}