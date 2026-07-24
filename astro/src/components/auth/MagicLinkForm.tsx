import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import PixelButton from '../ui/PixelButton';
import Input from '../ui/Input';

type OTPStatus = 'idle' | 'requesting' | 'verifying' | 'error';
type OTPStep = 'email' | 'code';

const adminRoles = new Set(['author', 'admin', 'super_admin']);

function getPostLoginRedirect(role: unknown) {
  return typeof role === 'string' && adminRoles.has(role) ? '/admin' : '/';
}

export default function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpId, setOtpId] = useState('');
  const [step, setStep] = useState<OTPStep>('email');
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [successRedirect, setSuccessRedirect] = useState('/');
  const { requestOTP, authWithOTP } = usePocketBase();

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => { window.location.href = successRedirect; }, 500);
    return () => clearTimeout(timer);
  }, [success, successRedirect]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const resetError = () => {
    if (status === 'error') {
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const requestCode = async () => {
    if (!email) {
      setStatus('error');
      setErrorMessage('请输入邮箱地址');
      return;
    }

    if (!isValidEmail(email)) {
      setStatus('error');
      setErrorMessage('邮箱格式不正确');
      return;
    }

    setStatus('requesting');
    setErrorMessage('');

    const { data, error } = await requestOTP(email);

    if (data?.otpId) {
      setOtpId(data.otpId);
      setCode('');
      setStep('code');
      setStatus('idle');
    } else {
      setStatus('error');
      setErrorMessage(getErrorMessage(error, '验证码发送失败，请稍后重试'));
    }
  };

  const verifyCode = async () => {
    const normalizedCode = code.trim();

    if (!otpId) {
      setStep('email');
      setStatus('error');
      setErrorMessage('请先获取验证码');
      return;
    }

    if (!normalizedCode) {
      setStatus('error');
      setErrorMessage('请输入验证码');
      return;
    }

    setStatus('verifying');
    setErrorMessage('');

    const { success: authSuccess, data, error } = await authWithOTP(otpId, normalizedCode);

    if (authSuccess) {
      setSuccessRedirect(getPostLoginRedirect(data?.record?.role));
      setSuccess(true);
      return;
    }

    setStatus('error');
    setErrorMessage(getErrorMessage(error, '验证码无效或已过期'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'email') await requestCode();
    else await verifyCode();
  };

  const goBackToEmail = () => {
    setStep('email');
    setOtpId('');
    setCode('');
    setStatus('idle');
    setErrorMessage('');
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  const isBusy = status === 'requesting' || status === 'verifying';

  return (
    <AnimatePresence mode="wait">
      {success ? (
        <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-3 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10">
            <svg className="h-7 w-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">验证成功</p>
        </motion.div>
      ) : (
        <motion.div key="form" initial={false} exit={{ opacity: 0, scale: 0.95 }}>
          <motion.form
            key="otp-form"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onSubmit={handleSubmit}
            className="space-y-4 sm:space-y-5"
            noValidate
          >
            <motion.div variants={itemVariants}>
              <h2 className="break-words text-lg font-bold tracking-tight text-zinc-900 dark:text-white sm:text-2xl">邮箱验证码登录</h2>
              <p className="mt-1.5 break-words text-sm leading-snug text-zinc-600 dark:text-zinc-400">
                使用 PocketBase OTP 验证码完成免密登录，也可作为二次验证入口。
              </p>
            </motion.div>

            <AnimatePresence mode="wait">
              {step === 'email' ? (
                <motion.div key="email-step" variants={itemVariants} initial="hidden" animate="visible" exit="exit">
                  <Input
                    label="邮箱地址"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      resetError();
                    }}
                    error={status === 'error' ? errorMessage : undefined}
                    required
                    autoComplete="email"
                  />
                </motion.div>
              ) : (
                <motion.div key="code-step" variants={itemVariants} initial="hidden" animate="visible" exit="exit" className="space-y-3 sm:space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-snug text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200 sm:px-4 sm:py-3" role="status" aria-live="polite">
                    验证码已发送，请查看邮箱并输入收到的验证码。
                  </div>

                  <Input
                    label="验证码"
                    type="text"
                    inputMode="numeric"
                    placeholder="输入邮箱验证码"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      resetError();
                    }}
                    error={status === 'error' ? errorMessage : undefined}
                    required
                    autoComplete="one-time-code"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={itemVariants} className="space-y-3">
              <PixelButton type="submit" loading={isBusy} variant="primary">
                {step === 'email'
                  ? status === 'requesting' ? '发送中...' : '发送验证码'
                  : status === 'verifying' ? '验证中...' : '验证并登录'}
              </PixelButton>

              {step === 'code' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <PixelButton type="button" onClick={requestCode} disabled={isBusy} variant="secondary">重新发送</PixelButton>
                  <PixelButton type="button" onClick={goBackToEmail} disabled={isBusy} variant="secondary">更换邮箱</PixelButton>
                </div>
              )}
            </motion.div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback;
  const maybeError = error as { message?: string; data?: { message?: string } };
  return maybeError.data?.message || maybeError.message || fallback;
}
