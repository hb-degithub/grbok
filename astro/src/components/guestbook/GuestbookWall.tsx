import React from 'react';
import { motion } from 'framer-motion';
import { fadeUp, staggerContainer } from '../../lib/motion';

interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

interface GuestbookWallProps {
  messages: GuestbookMessage[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

/** 相对时间：x 分钟前 / x 小时前 / x 天前 / 日期 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 留言墙：首字母色块 + 昵称 + 相对时间 + 内容（保留换行），分页加载更多 */
export default function GuestbookWall({ messages, loading, error, hasMore, loadingMore, onLoadMore, onRetry }: GuestbookWallProps) {
  if (loading) {
    return (
      <div className="grid gap-4" role="status" aria-busy="true">
        <span className="sr-only">留言加载中</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">留言加载失败，请稍后再试。</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        还没有留言，来抢沙发～
      </div>
    );
  }

  return (
    <div>
      <motion.ol variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4">
        {messages.map((msg) => (
          <motion.li
            key={msg.id}
            variants={fadeUp}
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-950" aria-hidden="true">
              {Array.from(msg.nickname)[0] ?? ''}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-50">{msg.nickname}</span>
                <time dateTime={msg.created} className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {relativeTime(msg.created)}
                </time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
                {msg.content}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {loadingMore && <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-600" aria-hidden="true" />}
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}
