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
 * 评论区主组件
 * 实现 Realtime 订阅、嵌套评论渲染和新评论高亮
 */
export function CommentSection({ postId }: CommentSectionProps) {
  const { comments, loading, error, submitComment, refresh } = useComments(postId);
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set());

  /**
   * 监听新评论
   * 当 comments 更新时，检测新增的评论 ID
   */
  useEffect(() => {
    // 收集所有评论 ID
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

    // 如果有新评论，添加到高亮列表
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

      // 3 秒后清除高亮
      const timer = setTimeout(() => {
        setNewCommentIds(new Set());
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [comments]);

  /**
   * 处理主评论提交
   */
  const handleMainSubmit = async (data: CommentFormData): Promise<boolean> => {
    return await submitComment(data);
  };

  /**
   * 处理回复提交
   */
  const handleReplySubmit = async (data: CommentFormData): Promise<boolean> => {
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
   * 统计评论数量（包括嵌套评论）
   */
  const countComments = (items: typeof comments): number => {
    return items.reduce((acc, item) => {
      return acc + 1 + countComments(item.children);
    }, 0);
  };

  const totalComments = countComments(comments);

  /**
   * 加载状态
   */
  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          评论区
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  /**
   * 错误状态
   */
  if (error) {
    return (
      <div className="rounded-xl bg-red-50 p-6 dark:bg-red-900/20">
        <p className="text-red-600 dark:text-red-400">
          加载评论失败: {error.message}
        </p>
        <button
          onClick={refresh}
          className="mt-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 评论区标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          评论区
        </h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {totalComments} 条评论
        </span>
      </div>

      {/* 主评论表单 */}
      <CommentForm postId={postId} onSubmit={handleMainSubmit} />

      {/* 评论列表 */}
      <AnimatePresence>
        {comments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl bg-gray-50 py-12 text-center dark:bg-gray-900"
          >
            <p className="text-gray-500 dark:text-gray-400">
              还没有评论，来发表第一条吧！
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
                onSubmitReply={handleReplySubmit}
                isNew={newCommentIds.has(comment.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
