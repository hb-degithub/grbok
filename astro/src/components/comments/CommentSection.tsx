import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useComments } from '../../hooks/useComments';
import type { CommentSubmitHandler } from '../../hooks/useComments';
import { useSiteSettings } from '../../hooks/useSiteSettings';
import { authService } from '../../lib/services/authService';
import CommentItem from './CommentItem';
import CommentForm from './CommentForm';
import type { CommentFormData } from '../../types/pocketbase';

interface CommentSectionProps {
  /** 文章 ID */
  postId: string;
}

/**
 * 评论区标题：等宽短标签 + 冷灰细线，与全站科幻简约语言一致。
 * 计数作为 children 传入，保留各状态自己的渲染位置。
 */
function SectionHeading({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--sf-line)] pb-3">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">Comments / 01</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--sf-ink)] sm:text-2xl">评论区</h2>
      </div>
      {children}
    </div>
  );
}

/**
 * 骨架屏评论 - 细线占位
 */
function SkeletonComment({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 sm:p-5"
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <div className="skeleton h-9 w-9 rounded-[2px]" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <div className="skeleton h-3.5 w-20 rounded-[2px]" />
            <div className="skeleton h-3 w-16 rounded-[2px]" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-3.5 w-full rounded-[2px]" />
            <div className="skeleton h-3.5 w-3/4 rounded-[2px]" />
          </div>
          <div className="skeleton h-3 w-12 rounded-[2px]" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 评论区主组件
 *
 * 设计决策：加载/错误/空三态统一细线风格，与正常态一致；
 * 错误态用 role="alert"，加载态用 aria-live，保证屏幕阅读器可感知。
 */
export default function CommentSection({ postId }: CommentSectionProps) {
  const { settings, loading: settingsLoading } = useSiteSettings();
  const commentsEnabled = !settingsLoading && settings.enable_comments;
  const { comments, loading, loadingMore, error, submitError, page, totalPages, totalItems, hasMore, submitComment, refresh, loadMore } = useComments(postId, { enabled: commentsEnabled });
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set());
  const seenCommentIdsRef = useRef<Set<string>>(new Set());
  const hasReceivedCommentsRef = useRef(false);
  // page 变大表示「加载更多」追加了更早的历史评论，不是实时新增
  const prevPageRef = useRef(page);
  // 上一帧的 loading：识别「一次取数刚刚完成」的快照。快照里的评论是基线，
  // 只有两次取数之间由实时订阅插入的评论才算 NEW。
  const prevLoadingRef = useRef(loading);
  // 每个新评论批次一个计时器：comments 再变化（update/父组件重渲染）时
  // 不能让已启动的计时器被清掉，否则 NEW 会永久粘滞。
  const newTimersRef = useRef<number[]>([]);

  const clearNewTimers = useCallback(() => {
    newTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    newTimersRef.current = [];
  }, []);

  // Track logged-in user's email verification status
  const [userEmailVerified, setUserEmailVerified] = useState<boolean | undefined>(undefined);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | undefined>(undefined);
  useEffect(() => {
    const sync = () => {
      setUserEmailVerified(authService.getUserEmailVerified());
      setCurrentUserEmail(authService.getUserEmail());
    };
    sync();
    const unsub = authService.onAuthChange(sync);
    return () => { unsub?.(); };
  }, []);

  /** 切换文章时重置「已见过」基线、待清理的计时器与高亮集合。 */
  useEffect(() => {
    seenCommentIdsRef.current = new Set();
    hasReceivedCommentsRef.current = false;
    // 文章的首次取数结果一律当快照处理（不沿用上一篇文章的分页/加载状态）
    prevPageRef.current = 0;
    prevLoadingRef.current = false;
    clearNewTimers();
    setNewCommentIds(new Set());
  }, [postId, clearNewTimers]);

  /** 组件卸载时清掉所有「NEW 消退」计时器。 */
  useEffect(() => () => clearNewTimers(), [clearNewTimers]);

  /**
   * 监听新评论，高亮 3 秒后消退。
   *
   * 规则：
   * 1. 每次取数完成（loading 由 true → false）或「加载更多」追加（page 变大）
   *    得到的都是快照：整体并入基线，不高亮——否则首次加载 / loadMore 的旧
   *    评论会被误标 NEW。
   * 2. 两次取数之间 comments 变化（实时订阅 create/update）才计算新 id；
   *    空评论区落定后收到的第一条实时评论因此能正确高亮。
   * 3. 每个新评论批次各自计时 3 秒，只移除本批 id；同批计时周期内 comments
   *    再次变化不会清掉计时器（旧实现会清掉后不再重排，导致永久粘滞）。
   */
  useEffect(() => {
    const allIds = new Set<string>();
    const collectIds = (items: typeof comments) => {
      items.forEach((item) => {
        allIds.add(item.id);
        if (item.children.length > 0) collectIds(item.children);
      });
    };
    collectIds(comments);

    const finishedLoading = prevLoadingRef.current && !loading;
    prevLoadingRef.current = loading;
    const pageIncreased = page > prevPageRef.current;
    prevPageRef.current = page;

    // 取数完成或加载更多：本次拿到的是快照，全部并入基线
    if (finishedLoading || pageIncreased) {
      seenCommentIdsRef.current = allIds;
      hasReceivedCommentsRef.current = true;
      return;
    }

    // 初始空态：先记为基线；之后第一条实时评论才能被识别为「新」
    if (allIds.size === 0) {
      seenCommentIdsRef.current = allIds;
      hasReceivedCommentsRef.current = true;
      return;
    }

    // 首次拿到评论列表只记录基线，不做高亮
    if (!hasReceivedCommentsRef.current) {
      hasReceivedCommentsRef.current = true;
      seenCommentIdsRef.current = allIds;
      return;
    }

    const newIds = new Set<string>();
    allIds.forEach((id) => {
      if (!seenCommentIdsRef.current.has(id)) newIds.add(id);
    });
    seenCommentIdsRef.current = allIds;

    if (newIds.size === 0) return;

    setNewCommentIds((prev) => {
      const next = new Set(prev);
      newIds.forEach((id) => next.add(id));
      return next;
    });

    // 只清理本批新增的 id；计时器存 ref，comments 再变也不会被 effect 清理
    const timer = window.setTimeout(() => {
      setNewCommentIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.delete(id));
        return next;
      });
      newTimersRef.current = newTimersRef.current.filter((t) => t !== timer);
    }, 3000);
    newTimersRef.current.push(timer);
  }, [comments, page, loading]);

  const handleSubmit: CommentSubmitHandler = async (data: CommentFormData) => {
    return await submitComment(data);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.4, staggerChildren: 0.06 } },
  };

  const countComments = (items: typeof comments): number =>
    items.reduce((acc, item) => acc + 1 + countComments(item.children), 0);
  const totalComments = countComments(comments);

  /** 加载状态 - 骨架屏 */
  if (settingsLoading || loading) {
    return (
      <section className="space-y-6" aria-busy="true" aria-live="polite">
        <SectionHeading />
        <div className="space-y-3">
          <SkeletonComment delay={0} />
          <SkeletonComment delay={0.08} />
          <SkeletonComment delay={0.16} />
        </div>
        <span className="sr-only">正在加载评论…</span>
      </section>
    );
  }

  if (!settings.enable_comments) {
    return (
      <section className="space-y-6">
        <SectionHeading />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center sm:p-12"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-[var(--sf-ink-3)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-[var(--sf-ink)]">评论已关闭</h3>
          <p className="text-sm text-[var(--sf-ink-3)]">站点管理员暂时关闭了评论功能。</p>
        </motion.div>
      </section>
    );
  }

  /** 错误状态 - 细线提示 */
  if (error) {
    return (
      <section className="space-y-6">
        <SectionHeading />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          role="alert"
          className="flex flex-col items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center sm:p-12"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-[var(--sf-danger)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-[var(--sf-danger)]">加载评论失败</h3>
          <p className="mb-4 text-sm text-[var(--sf-ink-2)]">{error.message}</p>
          <button
            onClick={() => refresh()}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
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
    <section className="space-y-6">
      {/* 评论区标题 */}
      <SectionHeading>
        <span
          className="shrink-0 rounded-[2px] border border-[var(--sf-line)] px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-2)]"
          aria-live="polite"
          aria-atomic="true"
        >
          {totalComments} 条评论
        </span>
      </SectionHeading>

      {/* 主评论表单 */}
      <CommentForm postId={postId} onSubmit={handleSubmit} moderationEnabled={settings.comment_moderation} userEmailVerified={userEmailVerified} serverError={submitError} />

      {/* 评论列表 */}
      <AnimatePresence>
        {comments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] py-14 text-center sm:py-16"
          >
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-[var(--sf-ink-3)]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-[var(--sf-ink)]">还没有评论</h3>
            <p className="text-sm text-[var(--sf-ink-3)]">来发表第一条吧！</p>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onSubmitReply={handleSubmit}
                isNew={newCommentIds.has(comment.id)}
                newCommentIds={newCommentIds}
                moderationEnabled={settings.comment_moderation}
                serverError={submitError}
                currentUserEmail={currentUserEmail}
              />
            ))}
            {/* 加载更多 */}
            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  className="focus-ring inline-flex min-h-11 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50"
                >
                  {loadingMore ? '加载中...' : `加载更多（${totalItems - comments.length} 条）`}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
