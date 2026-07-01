import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import Button from '../ui/Button';
import Input from '../ui/Input';
import AdminPasskeyStep from './AdminPasskeyStep';
import {
  RateLimiter,
  clearAuthFailures,
  formatAuthLock,
  getAuthAttemptKey,
  getAuthLockRemainingSeconds,
  normalizeAuthEmail,
  recordAuthFailure,
  setAuthLock,
  withAuthRequestHeaders,
} from '../../lib/security';

const loginLimiter = new RateLimiter(5, 1 / 12);
const otpLimiter = new RateLimiter(3, 1 / 30);
const adminRoles = new Set(['author', 'admin', 'super_admin']);

function getPostLoginRedirect(role: unknown) {
  return typeof role === 'string' && adminRoles.has(role) ? '/admin' : '/';
}

function getErrorResponse(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};
  const err = error as { response?: unknown; data?: unknown; status?: unknown };
  const response = err.response && typeof err.response === 'object' ? err.response as Record<string, unknown> : {};
  if (typeof err.status === 'number') response.status = err.status;
  if (err.data && typeof err.data === 'object') return { ...response, ...(err.data as Record<string, unknown>) };
  return response;
}

function getErrorMessage(error: unknown) {
  const response = getErrorResponse(error);
  const message = response.message;
  if (typeof message === 'string') return message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function getMfaId(error: unknown) {
  const response = getErrorResponse(error);
  return typeof response.mfaId === 'string' ? response.mfaId : '';
}

function shouldCooldown(error: unknown) {
  const response = getErrorResponse(error);
  const msg = getErrorMessage(error).toLowerCase();
  return response.status === 429 || msg.includes('过多') || msg.includes('锁定') || msg.includes('稍后') || msg.includes('blocked') || msg.includes('locked') || msg.includes('rate');
}

export default function PasswordLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpId, setOtpId] = useState('');
  const [mfaId, setMfaId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'mfa-sending' | 'mfa-verifying' | 'error'>('idle');
  const [passkeyStep, setPasskeyStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const isMfaStep = !!mfaId && !!otpId;

  const resetMfa = () => {
    setOtpCode('');
    setOtpId('');
    setMfaId('');
  };

  const failWithCooldown = (key: string, fallbackSeconds = 30 * 60) => {
    const seconds = setAuthLock(key, fallbackSeconds);
    setStatus('error');
    setErrorMessage(`登录尝试过多，请 ${formatAuthLock(seconds)} 后再试`);
  };

  const requestMfaCode = async (nextMfaId = mfaId) => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail || !nextMfaId) return;

    if (!otpLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('验证码请求太频繁，请稍后再试');
      return;
    }

    setStatus('mfa-sending');
    setErrorMessage('');

    try {
      const pb = getPocketBase();
      const result = await withAuthRequestHeaders(pb, () => pb.collection('users').requestOTP(normalizedEmail));
      setMfaId(nextMfaId);
      setOtpId(result.otpId);
      setOtpCode('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMessage('二次验证码发送失败，请稍后重试');
    }
  };

  const verifyMfaCode = async () => {
    const code = otpCode.trim();
    const key = getAuthAttemptKey(email);
    if (!code) {
      setStatus('error');
      setErrorMessage('请输入二次验证码');
      return;
    }

    const remaining = getAuthLockRemainingSeconds(key);
    if (remaining > 0) {
      setStatus('error');
      setErrorMessage(`登录尝试过多，请 ${formatAuthLock(remaining)} 后再试`);
      return;
    }

    setStatus('mfa-verifying');
    setErrorMessage('');

    try {
      const pb = getPocketBase();
      const auth = await withAuthRequestHeaders(pb, () => pb.collection('users').authWithOTP(otpId, code, { mfaId }));
      clearAuthFailures(key);
      handlePostLogin(auth.record?.role);
    } catch (err) {
      const lockSeconds = recordAuthFailure(key);
      setStatus('error');
      setErrorMessage(lockSeconds > 0 ? `验证码错误过多，请 ${formatAuthLock(lockSeconds)} 后再试` : '二次验证码无效或已过期');
    }
  };

  const handlePostLogin = (role: unknown) => {
    if (adminRoles.has(String(role))) {
      setPasskeyStep(true);
      setStatus('idle');
      return;
    }
    window.location.href = getPostLoginRedirect(role);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isMfaStep) {
      await verifyMfaCode();
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);
    const attemptKey = getAuthAttemptKey(normalizedEmail);
    const remaining = getAuthLockRemainingSeconds(attemptKey);

    if (!normalizedEmail || !password) {
      setStatus('error');
      setErrorMessage('请填写邮箱和密码');
      return;
    }

    if (remaining > 0) {
      setStatus('error');
      setErrorMessage(`登录尝试过多，请 ${formatAuthLock(remaining)} 后再试`);
      return;
    }

    if (!loginLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    setErrorMessage('');
    resetMfa();

    try {
      const pb = getPocketBase();
      const auth = await withAuthRequestHeaders(pb, () => pb.collection('users').authWithPassword(normalizedEmail, password));
      clearAuthFailures(attemptKey);
      handlePostLogin(auth.record?.role);
    } catch (err: unknown) {
      const nextMfaId = getMfaId(err);
      if (nextMfaId) {
        await requestMfaCode(nextMfaId);
        return;
      }

      if (shouldCooldown(err)) {
        failWithCooldown(attemptKey);
        return;
      }

      const lockSeconds = recordAuthFailure(attemptKey);
      setStatus('error');
      setErrorMessage(lockSeconds > 0 ? `登录失败次数过多，请 ${formatAuthLock(lockSeconds)} 后再试` : '邮箱或密码错误');
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  if (passkeyStep) {
    return (
      <AdminPasskeyStep
        onReturnToLogin={() => {
          setPasskeyStep(false);
          setStatus('idle');
        }}
      />
    );
  }

  return (
    <motion.form key="password-form" variants={containerVariants} initial="hidden" animate="visible" exit="exit" onSubmit={handleSubmit} className="space-y-3 sm:space-y-4" noValidate>
      <motion.div variants={itemVariants}>
        <Input label="邮箱" type="email" placeholder="your@email.com" value={email} onChange={(e) => { setEmail(e.target.value); resetMfa(); if (status === 'error') setStatus('idle'); }} error={status === 'error' ? errorMessage : undefined} required autoComplete="email" />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Input label="密码" type="password" placeholder="输入密码" value={password} onChange={(e) => { setPassword(e.target.value); resetMfa(); if (status === 'error') setStatus('idle'); }} required autoComplete="current-password" />
      </motion.div>

      {isMfaStep && (
        <motion.div variants={itemVariants} className="space-y-3 sm:space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-snug text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-4 sm:py-3" role="status" aria-live="polite">
            当前账号已启用二次验证，验证码已发送到邮箱。
          </div>
          <Input label="二次验证码" type="text" inputMode="numeric" placeholder="输入邮箱验证码" value={otpCode} onChange={(e) => { setOtpCode(e.target.value); if (status === 'error') setStatus('idle'); }} error={status === 'error' ? errorMessage : undefined} required autoComplete="one-time-code" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => requestMfaCode()} disabled={status === 'mfa-sending' || status === 'mfa-verifying'} className="w-full text-sm">{status === 'mfa-sending' ? '发送中...' : '重新发送'}</Button>
            <Button type="button" variant="ghost" onClick={resetMfa} disabled={status === 'mfa-verifying'} className="w-full text-sm">返回密码</Button>
          </div>
        </motion.div>
      )}

      <motion.div variants={itemVariants}>
        <Button type="submit" variant="primary" size="lg" loading={status === 'loading' || status === 'mfa-verifying'} className="w-full">
          {isMfaStep ? status === 'mfa-verifying' ? '验证中...' : '验证并登录' : status === 'loading' ? '登录中...' : '登录'}
        </Button>
      </motion.div>
    </motion.form>
  );
}
