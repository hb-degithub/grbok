import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useComments } from '../../hooks/useComments';
import { useSiteSettings } from '../../hooks/useSiteSettings';
import CommentItem from './CommentItem';
import CommentForm from './CommentForm';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentSectionProps {
  /** 文章 ID */
  postId: string;
}

/**
 * 骨架屏评论 - 玻璃底
 */
function SkeletonComment({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="glass rounded-2xl p-6"
      aria-hidden="true"
    >
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-full skeleton" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-4 w-20 skeleton" />
            <div className="h-3 w-16 skeleton" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full skeleton" />
            <div className="h-4 w-3/4 skeleton" />
          </div>
          <div className="h-3 w-12 skeleton" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 评论区主组件
 *
 * 设计决策：加载/错误/空三态统一玻璃风格，与正常态一致；
 * 错误态用 role="alert"，加载态用 aria-live，保证屏幕阅读器可感知。
 */
export function CommentSection({ postId }: CommentSectionProps) {
  const { settings, loading: settingsLoading } = useSiteSettings();
  const commentsEnabled = !settingsLoading && settings.enable_comments;
  const { comments, loading, error, submitComment, refresh } = useComments(postId, { enabled: commentsEnabled });
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set());

  /** 监听新评论，高亮 3 秒后消退 */
  useEffect(() => {
    const allIds = new Set<string>();
    const collectIds = (items: typeof comments) => {
      items.forEach((item) => {
        allIds.add(item.id);
        if (item.children.length > 0) collectIds(item.children);
      });
    };
    collectIds(comments);

    if (allIds.size > 0) {
      setNewCommentIds((prev) => {
        const newIds = new Set<string>();
        allIds.forEach((id) => {
          if (!prev.has(id)) newIds.add(id);
        });
        return newIds;
      });

      const timer = setTimeout(() => setNewCommentIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [comments]);

  const handleSubmit = async (data: CommentFormData): Promise<boolean> => {
    return await submitComment(data);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.5, staggerChildren: 0.1 } },
  };

  const countComments = (items: typeof comments): number =>
    items.reduce((acc, item) => acc + 1 + countComments(item.children), 0);
  const totalComments = countComments(comments);

  /** 加载状态 - 骨架屏 */
  if (settingsLoading || loading) {
    return (
      <section className="space-y-8" aria-busy="true" aria-live="polite">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-stone-900 dark:text-white">评论区</h2>
        </div>
        <div className="space-y-4">
          <SkeletonComment delay={0} />
          <SkeletonComment delay={0.1} />
          <SkeletonComment delay={0.2} />
        </div>
        <span className="sr-only">正在加载评论…</span>
      </section>
    );
  }

  if (!settings.enable_comments) {
    return (
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">评论区</h2>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass flex flex-col items-center justify-center rounded-2xl p-12 text-center"
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800/60">
            <svg className="h-7 w-7 text-stone-500 dark:text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-stone-700 dark:text-stone-300">评论已关闭</h3>
          <p className="text-sm text-stone-500 dark:text-stone-400">站点管理员暂时关闭了评论功能。</p>
        </motion.div>
      </section>
    );
  }

  /** 错误状态 - 玻璃提示 */
  if (error) {
    return (
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">评论区</h2>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="glass flex flex-col items-center justify-center rounded-2xl p-12 text-center"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
            <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">加载评论失败</h3>
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">{error.message}</p>
          <button
            onClick={refresh}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-stone-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重试
          </button>
        </motion.div>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      {/* 评论区标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">评论区</h2>
        <span className="glass rounded-full px-3 py-1 text-sm text-stone-600 dark:text-stone-400">
          {totalComments} 条评论
        </span>
      </div>

      {/* 主评论表单 */}
      <CommentForm postId={postId} onSubmit={handleSubmit} moderationEnabled={settings.comment_moderation} />

      {/* 评论列表 */}
      <AnimatePresence>
        {comments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass flex flex-col items-center justify-center rounded-2xl py-16 text-center"
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800/60">
              <svg className="h-10 w-10 text-stone-500 dark:text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-stone-700 dark:text-stone-300">还没有评论</h3>
            <p className="text-sm text-stone-500 dark:text-stone-400">来发表第一条吧！</p>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onSubmitReply={handleSubmit}
                isNew={newCommentIds.has(comment.id)}
                moderationEnabled={settings.comment_moderation}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
