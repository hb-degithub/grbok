import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * 密码登录表单
 * 不需要 SMTP 配置，PocketBase 默认支持
 */
export default function PasswordLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setStatus('error');
      setErrorMessage('请填写邮箱和密码');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const pb = getPocketBase();
      await pb.collection('users').authWithPassword(email, password);
      window.location.href = '/admin';
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || '登录失败，请检查邮箱和密码');
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

  return (
    <motion.form
      key="password-form"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onSubmit={handleSubmit}
      className="space-y-4"
      noValidate
    >
      <motion.div variants={itemVariants}>
        <Input
          label="邮箱"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }}
          error={status === 'error' ? errorMessage : undefined}
          required
          autoComplete="email"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Input
          label="密码"
          type="password"
          placeholder="输入密码"
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (status === 'error') setStatus('idle'); }}
          required
          autoComplete="current-password"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} className="w-full">
          {status === 'loading' ? '登录中…' : '登录'}
        </Button>
      </motion.div>
    </motion.form>
  );
}
