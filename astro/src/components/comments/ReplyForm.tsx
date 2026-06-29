import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { RateLimiter } from '../../lib/security';
import type { CommentFormData } from '../../types/pocketbase';

const replyLimiter = new RateLimiter(3, 1/12);

interface ReplyFormProps {
  /** 是否显示回复框 */
  isOpen: boolean;
  /** 关闭回复框回调 */
  onClose: () => void;
  /** 提交回调 */
  onSubmit: (data: CommentFormData) => Promise<boolean>;
  /** 父评论 ID */
  parentId?: string | null;
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
}

/** 共享 textarea 样式 - 玻璃底 + indigo focus-visible */
const textareaClass =
  'w-full rounded-xl border border-stone-200 bg-white/70 px-4 py-2.5 text-sm text-stone-900 placeholder-stone-400 transition-all duration-200 ease-out outline-none focus-visible:border-stone-500 focus-visible:ring-2 focus-visible:ring-stone-500/30 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus-visible:border-stone-400';

/**
 * 回复表单组件
 *
 * 设计决策：用 glass（比主表单的 glass-strong 更通透）表示「嵌套/次要」层级；
 * height:auto 过渡实现平滑展开收起；textarea 用 parentId 派生 id 关联 label。
 */
export function ReplyForm({ isOpen, onClose, onSubmit, parentId = null, moderationEnabled = true }: ReplyFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: parentId,
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

    if (!replyLimiter.tryConsume()) {
      setStatus('error');
      setErrorMessage('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    const success = await onSubmit({ ...formData, parent_id: parentId });

    if (success) {
      setStatus('success');
      setFormData({ author_name: '', author_email: '', content: '', parent_id: parentId });
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1500);
    } else {
      setStatus('error');
      setErrorMessage('提交失败，请重试');
    }
  };

  /** height:auto 平滑展开收起 */
  const formVariants = {
    hidden: { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.3, ease: 'easeInOut' } },
    visible: {
      opacity: 1,
      height: 'auto',
      marginTop: 16,
      transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
    },
    exit: { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.3, ease: 'easeInOut' } },
  };

  const successVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { type: 'spring' as const, stiffness: 500, damping: 15 },
    },
  };

  const contentId = `reply-content-${parentId ?? 'new'}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={formVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="overflow-hidden"
        >
          <form onSubmit={handleSubmit} className="glass rounded-xl p-4 sm:p-5" noValidate>
            {status === 'success' ? (
              /* ==================== 成功状态 ==================== */
              <motion.div
                variants={successVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-col items-center gap-2 py-4"
                role="status"
                aria-live="polite"
              >
                <motion.div
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                >
                  <svg className="h-6 w-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {moderationEnabled ? '回复已提交，审核后展示' : '回复已提交'}
                </p>
              </motion.div>
            ) : (
              /* ==================== 表单状态 ==================== */
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>

                <div>
                  <label htmlFor={contentId} className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">
                    回复内容
                  </label>
                  <textarea
                    id={contentId}
                    value={formData.content}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, content: e.target.value }));
                      if (status === 'error') setStatus('idle');
                    }}
                    placeholder="写下你的回复..."
                    rows={3}
                    className={textareaClass}
                    required
                  />
                </div>

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

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" size="sm" onClick={onClose} type="button">
                    取消
                  </Button>
                  <Button variant="primary" size="sm" type="submit" loading={status === 'loading'}>
                    发送回复
                  </Button>
                </div>
              </div>
            )}
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
