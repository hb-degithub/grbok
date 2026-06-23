import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * Magic Link 登录表单组件
 *
 * 设计决策：
 * 1. 状态机：idle → loading → sent | error。用 AnimatePresence mode="wait"
 *    实现状态间平滑切换，避免硬切跳变。
 * 2. 无障碍：错误信息用 role="alert" + aria-live，屏幕阅读器即时播报；
 *    表单 label 通过 Input 组件已与 input 关联。
 * 3. 邮箱格式校验在前端先做，减少无效请求。
 */
export default function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { requestMagicLink } = usePocketBase();
  const formRef = useRef<HTMLFormElement>(null);

  /** 简易邮箱格式校验，避免发明显非法的请求 */
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    setStatus('loading');
    setErrorMessage('');

    const { success, error } = await requestMagicLink(email);

    if (success) {
      setStatus('sent');
    } else {
      setStatus('error');
      setErrorMessage(error?.message || '发送失败，请稍后重试');
    }
  };

  /** 容器动画：状态切换时整体淡入上浮 */
  const containerVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, staggerChildren: 0.08, ease: [0.16, 1, 0.3, 1] },
    },
    exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  return (
    <AnimatePresence mode="wait">
      {status === 'sent' ? (
        /* ==================== 邮件已发送状态 ==================== */
        <motion.div
          key="sent"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="text-center"
          role="status"
          aria-live="polite"
        >
          <motion.div
            variants={itemVariants}
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
          >
            <motion.svg
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="h-8 w-8 text-emerald-600 dark:text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </motion.svg>
          </motion.div>

          <motion.h3
            variants={itemVariants}
            className="mb-2 text-xl font-semibold text-zinc-900 dark:text-white"
          >
            查收邮件
          </motion.h3>

          <motion.p
            variants={itemVariants}
            className="mb-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
          >
            我们已向 <span className="font-medium text-indigo-600 dark:text-indigo-400">{email}</span>{' '}
            发送了登录链接，有效期 15 分钟。
          </motion.p>

          <motion.div variants={itemVariants}>
            <Button variant="ghost" onClick={() => setStatus('idle')} className="text-sm">
              使用其他邮箱
            </Button>
          </motion.div>
        </motion.div>
      ) : (
        /* ==================== 邮箱输入状态 ==================== */
        <motion.form
          key="form"
          ref={formRef}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onSubmit={handleSubmit}
          className="space-y-5"
          noValidate
        >
          <motion.div variants={itemVariants}>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              登录 / 注册
            </h2>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              输入邮箱，我们将发送一个免密码登录链接
            </p>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Input
              label="邮箱地址"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                // 用户修改时清除错误态，避免红色提示残留
                if (status === 'error') setStatus('idle');
              }}
              error={status === 'error' ? errorMessage : undefined}
              required
              autoComplete="email"
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={status === 'loading'}
              className="w-full"
            >
              {status === 'loading' ? '发送中…' : '发送登录链接'}
            </Button>
          </motion.div>

          <motion.p
            variants={itemVariants}
            className="text-center text-xs text-zinc-500 dark:text-zinc-400"
          >
            无需密码，点击邮件中的链接即可登录
          </motion.p>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
