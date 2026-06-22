import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { CommentFormData } from '../../types/pocketbase';

interface ReplyFormProps {
  /** 是否显示回复框 */
  isOpen: boolean;
  /** 关闭回复框回调 */
  onClose: () => void;
  /** 提交回调 */
  onSubmit: (data: CommentFormData) => Promise<boolean>;
  /** 父评论 ID */
  parentId?: string | null;
}

/**
 * 回复表单组件
 * 使用 AnimatePresence 实现平滑的展开/收起动画
 */
export function ReplyForm({ isOpen, onClose, onSubmit, parentId = null }: ReplyFormProps) {
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: parentId,
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
      parent_id: parentId,
    });

    if (success) {
      setStatus('success');
      // 重置表单
      setFormData({
        author_name: '',
        author_email: '',
        content: '',
        parent_id: parentId,
      });
      // 1.5 秒后关闭
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1500);
    } else {
      setStatus('error');
      setErrorMessage('提交失败，请重试');
    }
  };

  /**
   * 动画配置
   * 使用 height: auto 实现平滑的高度过渡
   */
  const formVariants = {
    hidden: {
      opacity: 0,
      height: 0,
      marginTop: 0,
      transition: {
        duration: 0.3,
        ease: 'easeInOut',
      },
    },
    visible: {
      opacity: 1,
      height: 'auto',
      marginTop: 16,
      transition: {
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94], // 自定义贝塞尔曲线，更自然
      },
    },
    exit: {
      opacity: 0,
      height: 0,
      marginTop: 0,
      transition: {
        duration: 0.3,
        ease: 'easeInOut',
      },
    },
  };

  /**
   * 成功动画
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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={formVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="overflow-hidden"
        >
          <form onSubmit={handleSubmit} className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
            {status === 'success' ? (
              /* ==================== 成功状态 ==================== */
              <motion.div
                variants={successVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-col items-center gap-2 py-4"
              >
                {/* 打勾动画 */}
                <motion.div
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                >
                  <motion.svg
                    className="h-6 w-6 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                    />
                  </motion.svg>
                </motion.div>
                <p className="text-sm text-green-600 dark:text-green-400">
                  评论已提交
                </p>
              </motion.div>
            ) : (
              /* ==================== 表单状态 ==================== */
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
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
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    回复内容
                  </label>
                  <textarea
                    value={formData.content}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, content: e.target.value }))
                    }
                    placeholder="写下你的回复..."
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400"
                    required
                  />
                </div>

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

                {/* 操作按钮 */}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose} type="button">
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    loading={status === 'loading'}
                  >
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
