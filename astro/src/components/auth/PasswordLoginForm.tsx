import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import PixelButton from '../ui/PixelButton';
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
const adminRoles = new Set(['author', 'admin', 'super_admin']);

const containerVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

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
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [passkeyStep, setPasskeyStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => { window.location.href = getPostLoginRedirect(undefined); }, 500);
    return () => clearTimeout(timer);
  }, [success]);

  const failWithCooldown = (key: string, fallbackSeconds = 30 * 60) => {
    const seconds = setAuthLock(key, fallbackSeconds);
    setStatus('error');
    setErrorMessage(`登录尝试过多，请 ${formatAuthLock(seconds)} 后再试`);
  };

  const handlePostLogin = (role: unknown) => {
    if (adminRoles.has(String(role))) {
      setPasskeyStep(true);
      setStatus('idle');
      return;
    }
    setSuccess(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
    try {
      const pb = getPocketBase();
      const auth = await withAuthRequestHeaders(pb, () => pb.collection('users').authWithPassword(normalizedEmail, password));
      clearAuthFailures(attemptKey);
      handlePostLogin(auth.record?.role);
    } catch (err: unknown) {
      const nextMfaId = getMfaId(err);
      if (nextMfaId) {
        setStatus('error');
        setErrorMessage('MFA_UNSUPPORTED');
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
    <AnimatePresence mode="wait">
      {success ? (
        <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-3 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10">
            <svg className="h-7 w-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">登录成功</p>
        </motion.div>
      ) : (
        <motion.div key="form" initial={false} exit={{ opacity: 0, scale: 0.95 }}>
          <motion.form key="password-form" variants={containerVariants} initial="hidden" animate="visible" exit="exit" onSubmit={handleSubmit} className="space-y-3 sm:space-y-4" noValidate>
            <motion.div variants={itemVariants}>
              <Input label="邮箱" type="email" placeholder="your@email.com" value={email} onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }} error={status === 'error' ? errorMessage : undefined} required autoComplete="email" />
            </motion.div>

            <motion.div variants={itemVariants}>
              <Input label="密码" type="password" placeholder="输入密码" value={password} onChange={(e) => { setPassword(e.target.value); if (status === 'error') setStatus('idle'); }} required autoComplete="current-password" />
            </motion.div>

            <motion.div variants={itemVariants}>
              <PixelButton type="submit" loading={status === 'loading'} variant="primary">
                {status === 'loading' ? '登录中...' : '登录'}
              </PixelButton>
            </motion.div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
