import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useComments } from '../../hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentForm } from './CommentForm';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentSectionProps {
  /** 文章 ID */
  postId: string;
}

/**
 * 骨架屏评论组件
 */
function SkeletonComment({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-2xl border border-gray-200/60 p-6 dark:border-gray-800/60"
    >
      <div className="flex items-start gap-4">
        {/* 头像骨架 */}
        <div className="h-10 w-10 rounded-full skeleton" />
        <div className="flex-1 space-y-3">
          {/* 名称和时间骨架 */}
          <div className="flex items-center gap-3">
            <div className="h-4 w-20 skeleton" />
            <div className="h-3 w-16 skeleton" />
          </div>
          {/* 内容骨架 */}
          <div className="space-y-2">
            <div className="h-4 w-full skeleton" />
            <div className="h-4 w-3/4 skeleton" />
          </div>
          {/* 操作栏骨架 */}
          <div className="h-3 w-12 skeleton" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 评论区主组件
 * 实现 Realtime 订阅、嵌套评论渲染和新评论高亮
 */
export function CommentSection({ postId }: CommentSectionProps) {
  const { comments, loading, error, submitComment, refresh } = useComments(postId);
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set());

  /**
   * 监听新评论
   */
  useEffect(() => {
    const allIds = new Set<string>();
    const collectIds = (items: typeof comments) => {
      items.forEach((item) => {
        allIds.add(item.id);
        if (item.children.length > 0) {
          collectIds(item.children);
        }
      });
    };
    collectIds(comments);

    if (allIds.size > 0) {
      setNewCommentIds((prev) => {
        const newIds = new Set<string>();
        allIds.forEach((id) => {
          if (!prev.has(id)) {
            newIds.add(id);
          }
        });
        return newIds;
      });

      const timer = setTimeout(() => {
        setNewCommentIds(new Set());
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [comments]);

  /**
   * 处理评论提交
   */
  const handleSubmit = async (data: CommentFormData): Promise<boolean> => {
    return await submitComment(data);
  };

  /**
   * 容器动画配置
   */
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
    },
  };

  /**
   * 统计评论数量
   */
  const countComments = (items: typeof comments): number => {
    return items.reduce((acc, item) => {
      return acc + 1 + countComments(item.children);
    }, 0);
  };

  const totalComments = countComments(comments);

  /**
   * 加载状态 - 优雅的骨架屏
   */
  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">评论区</h2>
        </div>
        <div className="space-y-4">
          <SkeletonComment delay={0} />
          <SkeletonComment delay={0.1} />
          <SkeletonComment delay={0.2} />
        </div>
      </div>
    );
  }

  /**
   * 错误状态
   */
  if (error) {
    return (
      <div className="space-y-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">评论区</h2>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-12 text-center dark:border-red-800 dark:bg-red-900/20"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
            <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">
            加载评论失败
          </h3>
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error.message}
          </p>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-xl bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重试
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 评论区标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          评论区
        </h2>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {totalComments} 条评论
        </span>
      </div>

      {/* 主评论表单 */}
      <CommentForm postId={postId} onSubmit={handleSubmit} />

      {/* 评论列表 */}
      <AnimatePresence>
        {comments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center rounded-2xl border border-gray-200/60 bg-gray-50 py-16 text-center dark:border-gray-800/60 dark:bg-gray-900"
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
              <svg className="h-10 w-10 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-700 dark:text-gray-300">
              还没有评论
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              来发表第一条吧！
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-4"
          >
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onSubmitReply={handleSubmit}
                isNew={newCommentIds.has(comment.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
