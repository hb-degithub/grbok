import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { RateLimiter } from '../../lib/security';
import type { CommentFormData } from '../../types/pocketbase';

const commentLimiter = new RateLimiter(3, 1/12); // 每分钟最多3条

interface CommentFormProps {
  /** 文章 ID */
  postId: string;
  /** 提交回调 */
  onSubmit: (data: CommentFormData) => Promise<boolean>;
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
}

/** 共享 textarea 样式 - 玻璃底 + indigo focus-visible */
const textareaClass =
  'w-full rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 transition-all duration-200 ease-out outline-none focus-visible:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-500/30 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus-visible:border-zinc-400';

/**
 * 主评论表单组件
 *
 * 设计决策：glass-strong 容器保证表单文字对比度；textarea 用 id 关联 label，
 * 支持 `aria-describedby` 错误播报；成功态用 emerald 打勾动画。
 */
export default function CommentForm({ postId, onSubmit, moderationEnabled = true }: CommentFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: null,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.author_name || !formData.author_email || !formData.content) {
      setStatus('error');
      setErrorMessage('请填写所有必填字段');
      return;
    }

    if (!commentLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    const success = await onSubmit({ ...formData, parent_id: null });

    if (success) {
      setStatus('success');
      setFormData({ author_name: '', author_email: '', content: '', parent_id: null });
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMessage('提交失败，请重试');
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  const successVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { type: 'spring' as const, stiffness: 500, damping: 15 },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="glass-strong rounded-lg p-6 sm:p-7"
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
            role="status"
            aria-live="polite"
          >
            <motion.div
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <motion.svg
                className="h-8 w-8 text-emerald-600 dark:text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
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
              className="text-lg font-medium text-emerald-600 dark:text-emerald-400"
            >
              {moderationEnabled ? '评论提交成功，审核后展示！' : '评论提交成功！'}
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
            noValidate
          >
            <motion.div variants={itemVariants}>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">发表评论</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {moderationEnabled ? '你的邮箱不会被公开显示，评论审核后展示' : '你的邮箱不会被公开显示'}
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2">
              <Input
                label="昵称"
                placeholder="你的昵称"
                value={formData.author_name}
                onChange={(e) => setFormData((prev) => ({ ...prev, author_name: e.target.value }))}
                required
                autoComplete="name"
              />
              <Input
                label="邮箱"
                type="email"
                placeholder="your@email.com"
                value={formData.author_email}
                onChange={(e) => setFormData((prev) => ({ ...prev, author_email: e.target.value }))}
                required
                autoComplete="email"
              />
            </motion.div>

            <motion.div variants={itemVariants}>
              <label htmlFor="comment-content" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                评论内容
              </label>
              <textarea
                id="comment-content"
                value={formData.content}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, content: e.target.value }));
                  if (status === 'error') setStatus('idle');
                }}
                placeholder="写下你的想法..."
                rows={4}
                className={textareaClass}
                required
              />
            </motion.div>

            {/* 错误提示 */}
            {status === 'error' && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400"
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {errorMessage}
              </motion.p>
            )}

            <motion.div variants={itemVariants}>
              <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} className="w-full sm:w-auto">
                发表评论
              </Button>
            </motion.div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
