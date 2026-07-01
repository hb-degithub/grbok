import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { RateLimiter } from '../../lib/security';

type RegisterStatus = 'idle' | 'loading' | 'error';

export default function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { registerReader } = usePocketBase();

  const registerLimiter = new RateLimiter(5, 0.2);

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
    const trimmedName = name.trim();

    if (!trimmedName || !trimmedEmail || !password || !passwordConfirm) {
      setStatus('error');
      setErrorMessage('请填写昵称、邮箱、密码和确认密码');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setStatus('error');
      setErrorMessage('邮箱格式不正确');
      return;
    }

    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('密码至少需要 8 个字符');
      return;
    }

    if (!registerLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('Too many attempts, please try again later');
      return;
    }

    if (password !== passwordConfirm) {
      setStatus('error');
      setErrorMessage('两次输入的密码不一致');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    const { success } = await registerReader({
      email: trimmedEmail,
      name: trimmedName,
      password,
      passwordConfirm,
    });

    if (success) {
      window.location.href = '/';
      return;
    }

    setStatus('error');
    setErrorMessage('注册失败，请检查信息后重试');
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

  return (
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
          error={status === 'error' && !name.trim() ? errorMessage : undefined}
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
          error={status === 'error' ? errorMessage : undefined}
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
          required
          autoComplete="new-password"
        />
      </motion.div>

      <motion.p variants={itemVariants} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm leading-snug text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 sm:px-4 sm:py-3">
        注册后默认获得 reader 权限，后台权限需要超级管理员另行分配。
      </motion.p>

      <motion.div variants={itemVariants}>
        <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} className="w-full">
          {status === 'loading' ? '注册中...' : '注册并登录'}
        </Button>
      </motion.div>
    </motion.form>
  );
}
