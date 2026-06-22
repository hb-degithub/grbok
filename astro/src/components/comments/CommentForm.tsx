import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentFormProps {
  /** 文章 ID */
  postId: string;
  /** 提交回调 */
  onSubmit: (data: CommentFormData) => Promise<boolean>;
}

/**
 * 主评论表单组件
 * 用于在文章底部提交新评论
 */
export function CommentForm({ postId, onSubmit }: CommentFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: null,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  /**
   * 表单提交处理
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.author_name || !formData.author_email || !formData.content) {
      setStatus('error');
      setErrorMessage('请填写所有必填字段');
      return;
    }

    setStatus('loading');

    const success = await onSubmit({
      ...formData,
      parent_id: null,
    });

    if (success) {
      setStatus('success');
      // 重置表单
      setFormData({
        author_name: '',
        author_email: '',
        content: '',
        parent_id: null,
      });
      // 2 秒后重置状态
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMessage('提交失败，请重试');
    }
  };

  /**
   * 容器动画
   */
  const containerVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
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

  /**
   * 成功打勾动画
   */
  const successVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: {
        type: 'spring',
        stiffness: 500,
        damping: 15,
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900"
    >
      <AnimatePresence mode="wait">
        {status === 'success' ? (
          /* ==================== 成功状态 ==================== */
          <motion.div
            key="success"
            variants={successVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="flex flex-col items-center gap-3 py-8"
          >
            {/* 打勾动画 */}
            <motion.div
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <motion.svg
                className="h-8 w-8 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <motion.path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                />
              </motion.svg>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-lg font-medium text-green-600 dark:text-green-400"
            >
              评论提交成功！
            </motion.p>
          </motion.div>
        ) : (
          /* ==================== 表单状态 ==================== */
          <motion.form
            key="form"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* 标题 */}
            <motion.div variants={itemVariants}>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                发表评论
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                你的邮箱不会被公开显示
              </p>
            </motion.div>

            {/* 昵称和邮箱 */}
            <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2">
              <Input
                label="昵称"
                placeholder="你的昵称"
                value={formData.author_name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, author_name: e.target.value }))
                }
                required
              />
              <Input
                label="邮箱"
                type="email"
                placeholder="your@email.com"
                value={formData.author_email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, author_email: e.target.value }))
                }
                required
              />
            </motion.div>

            {/* 评论内容 */}
            <motion.div variants={itemVariants}>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                评论内容
              </label>
              <textarea
                value={formData.content}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, content: e.target.value }))
                }
                placeholder="写下你的想法..."
                rows={4}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400"
                required
              />
            </motion.div>

            {/* 错误提示 */}
            {status === 'error' && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-500"
              >
                {errorMessage}
              </motion.p>
            )}

            {/* 提交按钮 */}
            <motion.div variants={itemVariants}>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={status === 'loading'}
                className="w-full sm:w-auto"
              >
                发表评论
              </Button>
            </motion.div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
