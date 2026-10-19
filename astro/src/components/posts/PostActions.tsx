import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { getPocketBase } from '../../lib/pocketbase';
import { postService } from '../../lib/services/postService';
import { isAuthRequiredError, isRateLimitedError } from '../../lib/services/actionRequest';

interface PostActionsProps {
  /** 文章 ID */
  postId: string;
  /** 初始点赞数（来自 SSR 数据） */
  initialLikes?: number;
}

type AuthState = 'loading' | 'authenticated' | 'guest';

/**
 * 文章点赞与收藏组件
 *
 * 安全模型（2026-10-14 渗透测试 #3 修复）：
 * 1. 点赞/收藏**必须登录**，服务端按用户 id 去重；匿名点击只给出「请先登录」，
 *    绝不在本地假装 +1（旧版用 localStorage 记录 isLiked 属于本地伪造状态）。
 * 2. 取消点赞/收藏走新的 `DELETE /api/posts/:id/like|bookmark`。
 * 3. 点赞数为**服务端权威值**：以接口返回的 likes 覆盖本地状态。
 *
 * 设计决策：
 * 1. 必须 `export default`，禁止命名导出（AGENTS.md 核心约束）。
 * 2. 客户端挂载指令由调用方在 `.astro` 页面里指定（`client:visible` 或 `client:load`）。
 * 3. 登录态在 `useEffect` 中读取 `pb.authStore`，避免 SSR 期访问 `window`
 *    导致 hydration mismatch。
 * 4. 视觉风格与评论点赞一致：heart SVG + likes count，bookmark 用 `M5 5a2...` 路径；
 *    按钮带 aria-pressed 表达切换状态。
 */
export default function PostActions({ postId, initialLikes = 0 }: PostActionsProps) {
  const [likes, setLikes] = useState(initialLikes);
  const [isLiked, setIsLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);

  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [needsLogin, setNeedsLogin] = useState(false);

  // 操作失败的可见反馈：仅写 console 时用户无感知，这里给出短暂内联提示
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
  }, []);

  const showActionError = (message: string) => {
    setActionError(message);
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setActionError(null), 4000);
  };

  const showNeedsLogin = () => {
    setNeedsLogin(true);
    showActionError('请先登录后再点赞或收藏');
  };

  // SSR 安全：仅在浏览器端水合后读取登录态
  useEffect(() => {
    try {
      const pb = getPocketBase();
      const valid = Boolean(pb?.authStore?.isValid && pb.authStore.record);
      setAuthState(valid ? 'authenticated' : 'guest');
    } catch {
      setAuthState('guest');
    }
  }, []);

  /** 点赞 / 取消点赞 */
  const handleLike = async () => {
    if (isLiking) return;
    if (authState !== 'authenticated') {
      // 未登录：不请求、不本地 +1，只提示登录
      showNeedsLogin();
      return;
    }
    const nextLiked = !isLiked;
    setIsLiking(true);
    try {
      const result = nextLiked
        ? await postService.likePost(postId)
        : await postService.unlikePost(postId);
      if (typeof result?.likes === 'number') setLikes(result.likes);
      setIsLiked(nextLiked);
      setActionError(null);
      setNeedsLogin(false);
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setAuthState('guest');
        showNeedsLogin();
      } else if (isRateLimitedError(err)) {
        showActionError('操作过于频繁，请稍后再试');
      } else {
        console.error('点赞失败:', err);
        showActionError('点赞失败，请稍后再试');
      }
    } finally {
      setIsLiking(false);
    }
  };

  /** 收藏 / 取消收藏 */
  const handleBookmark = async () => {
    if (isBookmarking) return;
    if (authState !== 'authenticated') {
      showNeedsLogin();
      return;
    }
    const nextBookmarked = !isBookmarked;
    setIsBookmarking(true);
    try {
      const result = nextBookmarked
        ? await postService.bookmarkPost(postId)
        : await postService.unbookmarkPost(postId);
      setIsBookmarked(typeof result?.bookmarked === 'boolean' ? result.bookmarked : nextBookmarked);
      setActionError(null);
      setNeedsLogin(false);
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setAuthState('guest');
        showNeedsLogin();
      } else if (isRateLimitedError(err)) {
        showActionError('操作过于频繁，请稍后再试');
      } else {
        console.error('收藏失败:', err);
        showActionError('收藏失败，请稍后再试');
      }
    } finally {
      setIsBookmarking(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* 点赞 */}
      <button
        type="button"
        onClick={handleLike}
        disabled={isLiking}
        className={cn(
          'focus-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors',
          isLiked
            ? 'text-teal-600 dark:text-teal-400'
            : 'text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500'
        )}
        aria-label={isLiked ? '取消点赞' : '点赞'}
        aria-pressed={isLiked}
        title={authState === 'guest' ? '请先登录后再点赞' : undefined}
      >
        <svg className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
        <span>{likes}</span>
      </button>

      {/* 收藏 */}
      <button
        type="button"
        onClick={handleBookmark}
        disabled={isBookmarking}
        className={cn(
          'focus-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors',
          isBookmarked
            ? 'text-teal-600 dark:text-teal-400'
            : 'text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500'
        )}
        aria-label={isBookmarked ? '取消收藏' : '收藏'}
        aria-pressed={isBookmarked}
        title={authState === 'guest' ? '请先登录后再收藏' : undefined}
      >
        <svg className="h-4 w-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        {isBookmarked ? '已收藏' : '收藏'}
      </button>

      {/* 需要登录 / 操作失败的可见反馈 */}
      {needsLogin && (
        <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
          请先
          <a href="/login" className="mx-0.5 text-teal-600 no-underline hover:underline dark:text-teal-400">
            登录
          </a>
          后再操作
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}
    </div>
  );
}
