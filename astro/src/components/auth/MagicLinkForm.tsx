import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * Magic Link 登录表单组件
 * 实现带 Framer Motion 状态切换的登录流程
 */
export default function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { requestMagicLink } = usePocketBase();

  /**
   * 表单提交处理
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setStatus('error');
      setErrorMessage('请输入邮箱地址');
      return;
    }

    setStatus('loading');

    const { success, error } = await requestMagicLink(email);

    if (success) {
      setStatus('sent');
    } else {
      setStatus('error');
      setErrorMessage(error?.message || '发送失败，请重试');
    }
  };

  /**
   * 动画变体配置
   * 定义组件在不同状态下的动画效果
   */
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1, // 子元素交错入场延迟
      },
    },
    exit: {
      opacity: 0,
      y: -20,
      transition: { duration: 0.3 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4 },
    },
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
        >
          {/* 成功图标 */}
          <motion.div
            variants={itemVariants}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
          >
            <motion.svg
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="h-8 w-8 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </motion.svg>
          </motion.div>

          {/* 提示文字 */}
          <motion.h3
            variants={itemVariants}
            className="mb-2 text-xl font-semibold text-gray-900 dark:text-white"
          >
            查收邮件
          </motion.h3>

          <motion.p
            variants={itemVariants}
            className="mb-6 text-gray-600 dark:text-gray-400"
          >
            我们已向 <span className="font-medium text-blue-600">{email}</span> 发送了登录链接
          </motion.p>

          {/* 重新发送按钮 */}
          <motion.div variants={itemVariants}>
            <Button
              variant="ghost"
              onClick={() => setStatus('idle')}
              className="text-sm"
            >
              使用其他邮箱
            </Button>
          </motion.div>
        </motion.div>
      ) : (
        /* ==================== 邮箱输入状态 ==================== */
        <motion.form
          key="form"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* 标题 */}
          <motion.div variants={itemVariants}>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              登录 / 注册
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              输入邮箱，我们将发送一个免密码登录链接
            </p>
          </motion.div>

          {/* 邮箱输入框 */}
          <motion.div variants={itemVariants}>
            <Input
              label="邮箱地址"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={status === 'error' ? errorMessage : undefined}
              required
              autoComplete="email"
            />
          </motion.div>

          {/* 提交按钮 */}
          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={status === 'loading'}
              className="w-full"
            >
              发送登录链接
            </Button>
          </motion.div>

          {/* 说明文字 */}
          <motion.p
            variants={itemVariants}
            className="text-center text-xs text-gray-500 dark:text-gray-400"
          >
            无需密码，点击邮件中的链接即可登录
          </motion.p>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
