import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import { useAltchaGate } from '../../hooks/useAltchaGate';
import PixelButton from '../ui/PixelButton';
import Input from '../ui/Input';
import FormStatus from './FormStatus';
import AltchaField from './AltchaField';
import { captchaErrorMessage } from '../../lib/captcha';
import { RateLimiter } from '../../lib/security';

const registerLimiter = new RateLimiter(5, 0.2);

type RegisterStatus = 'idle' | 'loading' | 'error';
type RegisterField = 'email' | 'password' | 'passwordConfirm';

export default function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const [success, setSuccess] = useState(false);
  const { registerReader } = usePocketBase();
  // ALTCHA 人机验证：blocked 时禁用提交，payload 随注册请求一起提交。
  const captcha = useAltchaGate();

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => { window.location.href = '/?verify_email_sent=1'; }, 500);
    return () => clearTimeout(timer);
  }, [success]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const clearError = () => {
    if (status === 'error') {
      setStatus('idle');
      setFormError('');
      setFieldErrors({});
    }
  };

  const fail = (fields: Partial<Record<RegisterField, string>>, message = '') => {
    setStatus('error');
    setFieldErrors(fields);
    setFormError(message);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!trimmedName || !trimmedEmail || !password || !passwordConfirm) {
      fail({}, '请填写昵称、邮箱、密码和确认密码');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      fail({ email: '邮箱格式不正确' });
      return;
    }

    if (password.length < 8) {
      fail({ password: '密码至少需要 8 个字符' });
      return;
    }

    if (!registerLimiter.tryConsume()) {
      fail({}, 'Too many attempts, please try again later');
      return;
    }

    if (password !== passwordConfirm) {
      fail({ passwordConfirm: '两次输入的密码不一致' });
      return;
    }

    // 人机验证闸门：widget 明确处于未验证状态时不允许提交。
    // 放在既有校验之后，保持原有校验顺序与文案不变。
    if (captcha.blocked) {
      fail({}, '请先完成人机验证后再提交');
      return;
    }

    setStatus('loading');
    setFormError('');
    setFieldErrors({});

    const { success: registerSuccess, error } = await registerReader({
      email: trimmedEmail,
      name: trimmedName,
      password,
      passwordConfirm,
      // payload 只在拿到验证结果时出现；undefined 字段不会被序列化
      ...captcha.field,
    });

    if (registerSuccess) {
      // 成功即重置：旧 challenge 已被服务端消费。
      captcha.reset();
      setSuccess(true);
      return;
    }

    const captchaFailure = captchaErrorMessage(error);
    if (captchaFailure) {
      // 服务端拒绝（REQUIRED/INVALID/EXPIRED/REPLAY/UNCONFIGURED）：
      // 重新取挑战，并给出可读提示。
      captcha.reset();
      fail({}, captchaFailure);
      return;
    }

    setStatus('error');
    setFormError('注册失败，请检查信息后重试');
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  return (
    <AnimatePresence mode="wait">
      {success ? (
        <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-3 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-line-soft)]">
            <svg className="h-7 w-7 text-[var(--sf-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-sm font-medium text-[var(--sf-ink)]">提交已受理，请验证邮箱</p>
        </motion.div>
      ) : (
    <motion.form
      key="register-form"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onSubmit={handleSubmit}
      className="space-y-3 sm:space-y-4"
      noValidate
    >
      <motion.div variants={itemVariants}>
        <Input
          label="昵称"
          type="text"
          placeholder="你的昵称"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearError();
          }}
          required
          autoComplete="name"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Input
          label="邮箱"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError();
          }}
          error={fieldErrors.email}
          required
          autoComplete="email"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Input
          label="密码"
          type="password"
          placeholder="至少 8 个字符"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError();
          }}
          error={fieldErrors.password}
          required
          autoComplete="new-password"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Input
          label="确认密码"
          type="password"
          placeholder="再次输入密码"
          value={passwordConfirm}
          onChange={(e) => {
            setPasswordConfirm(e.target.value);
            clearError();
          }}
          error={fieldErrors.passwordConfirm}
          required
          autoComplete="new-password"
        />
      </motion.div>

      <motion.p variants={itemVariants} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-line-soft)] px-3 py-2.5 text-sm leading-snug text-[var(--sf-ink-2)] sm:px-4 sm:py-3">
        注册后默认获得 reader 权限，后台权限需要超级管理员另行分配。验证邮箱后即可发表评论。
      </motion.p>

      <motion.div variants={itemVariants}>
        <AltchaField
          ref={captcha.ref}
          id="register-altcha"
          onVerified={captcha.onVerified}
          onStatusChange={captcha.onStatusChange}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <FormStatus message={formError} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <PixelButton type="submit" loading={status === 'loading'} disabled={captcha.blocked} variant="primary">
          {status === 'loading' ? '提交中...' : '提交注册'}
        </PixelButton>
      </motion.div>
    </motion.form>
      )}
    </AnimatePresence>
  );
}
