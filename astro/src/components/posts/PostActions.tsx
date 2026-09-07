import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { postService } from '../../lib/services/postService';

interface PostActionsProps {
  /** 文章 ID */
  postId: string;
  /** 初始点赞数（来自 SSR 数据） */
  initialLikes?: number;
}

/**
 * 文章点赞与收藏组件
 *
 * 设计决策：
 * 1. 必须 `export default`，禁止命名导出（AGENTS.md 核心约束）。
 * 2. 客户端挂载指令由调用方在 `.astro` 页面里指定（`client:visible` 或 `client:load`），
 *    组件自身不感知 SSR 指令。
 * 3. 浏览器本地状态（localStorage 记录已点赞/已收藏）必须在 `useEffect` 中读取，
 *    避免 SSR 期访问 `window` 导致 hydration mismatch（参考 CommentForm 模式）。
 * 4. 视觉风格与评论点赞一致：heart SVG + likes count，bookmark 用 `M5 5a2...` 路径。
 */
export default function PostActions({ postId, initialLikes = 0 }: PostActionsProps) {
  const [likes, setLikes] = useState(initialLikes);
  const [isLiked, setIsLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);

  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);

  // SSR 安全：仅在浏览器端水合后读取 localStorage，恢复用户本地状态
  useEffect(() => {
    if (!postId) return;
    try {
      const liked = window.localStorage.getItem(`post-like:${postId}`) === '1';
      const bookmarked = window.localStorage.getItem(`post-bookmark:${postId}`) === '1';
      setIsLiked(liked);
      setIsBookmarked(bookmarked);
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级为未操作状态
    }
  }, [postId]);

  const handleLike = async () => {
    if (isLiked || isLiking) return;
    setIsLiking(true);
    try {
      const result = await postService.likePost(postId);
      setLikes(result.likes);
      setIsLiked(true);
      try {
        window.localStorage.setItem(`post-like:${postId}`, '1');
      } catch {
        // 忽略本地存储失败
      }
    } catch (err) {
      console.error('点赞失败:', err);
    } finally {
      setIsLiking(false);
    }
  };

  const handleBookmark = async () => {
    if (isBookmarking) return;
    setIsBookmarking(true);
    try {
      const result = await postService.toggleBookmark(postId);
      setIsBookmarked(result.bookmarked);
      try {
        window.localStorage.setItem(`post-bookmark:${postId}`, result.bookmarked ? '1' : '0');
      } catch {
        // 忽略本地存储失败
      }
    } catch (err) {
      console.error('收藏失败:', err);
    } finally {
      setIsBookmarking(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* 点赞 */}
      <button
        onClick={handleLike}
        disabled={isLiked || isLiking}
        className={cn(
          'focus-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors',
          isLiked
            ? 'text-teal-600 dark:text-teal-400'
            : 'text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500'
        )}
        aria-label={isLiked ? '已点赞' : '点赞'}
      >
        <svg className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
        {likes > 0 && <span>{likes}</span>}
      </button>

      {/* 收藏 */}
      <button
        onClick={handleBookmark}
        disabled={isBookmarking}
        className={cn(
          'focus-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors',
          isBookmarked
            ? 'text-teal-600 dark:text-teal-400'
            : 'text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500'
        )}
        aria-label={isBookmarked ? '取消收藏' : '收藏'}
      >
        <svg className="h-4 w-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        {isBookmarked ? '已收藏' : '收藏'}
      </button>
    </div>
  );
}
