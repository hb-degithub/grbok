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
  /** 「加载更多」这一次失败了：就地提示，不清空已有留言 */
  loadMoreError: boolean;
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

/** 细线面板：空态 / 首屏错误态共用，保持同一套结构线与方角 */
function Panel({
  state,
  role,
  children,
}: {
  state: 'empty' | 'error';
  role?: 'alert';
  children: React.ReactNode;
}) {
  return (
    <div
      data-state={state}
      role={role}
      className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center"
    >
      {children}
    </div>
  );
}

/**
 * 留言墙：方角首字母 + 昵称 + 相对时间 + 内容（保留换行），分页加载更多。
 *
 * 状态语义：
 * - 首屏加载（还没有任何留言）才显示骨架；加载更多时保留列表，只在按钮上转圈；
 * - 首屏失败显示整块错误态与「重新加载」；
 * - 加载更多失败在列表下方就地提示，已有留言不被替换，重试继续取下一页。
 */
export default function GuestbookWall({
  messages,
  loading,
  error,
  loadMoreError,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
}: GuestbookWallProps) {
  if (loading && messages.length === 0) {
    return (
      <div className="grid gap-4" role="status" aria-busy="true" data-state="loading">
        <span className="sr-only">留言加载中</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-[3px]" />
        ))}
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <Panel state="error" role="alert">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-danger)]">Error / 留言</p>
        <p className="mt-2 text-sm text-[var(--sf-ink-2)]">留言加载失败，请稍后再试。</p>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-[3px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
        >
          重新加载
        </button>
      </Panel>
    );
  }

  if (messages.length === 0) {
    return (
      <Panel state="empty">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">Guestbook / 00</p>
        <p className="mt-2 text-sm text-[var(--sf-ink-3)]">还没有留言，来抢沙发～</p>
      </Panel>
    );
  }

  return (
    <div data-state="ready">
      <motion.ol variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4">
        {messages.map((msg) => (
          <motion.li
            key={msg.id}
            variants={fadeUp}
            className="flex items-start gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 transition-colors hover:border-[var(--sf-line-strong)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] bg-[var(--sf-canvas)] font-mono text-sm font-semibold text-[var(--sf-ink)]" aria-hidden="true">
              {Array.from(msg.nickname)[0] ?? ''}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold text-[var(--sf-ink)]">{msg.nickname}</span>
                <time dateTime={msg.created} className="shrink-0 font-mono text-[11px] text-[var(--sf-ink-3)]">
                  {relativeTime(msg.created)}
                </time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
                {msg.content}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      {loadMoreError && (
        <div
          role="alert"
          data-state="load-more-error"
          className="mt-4 rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] p-4 text-center"
        >
          <p className="text-sm font-medium text-[var(--sf-ink)]">加载更多失败，请重试。</p>
          <p className="mt-1 text-xs leading-5 text-[var(--sf-ink-3)]">已经显示的留言不受影响。</p>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-[3px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50"
          >
            重试加载更多
          </button>
        </div>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[3px] border border-[var(--sf-line-control)] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50"
          >
            {loadingMore && <span className="h-3 w-3 animate-spin rounded-[1px] border border-[var(--sf-line-strong)] border-t-[var(--sf-accent)]" aria-hidden="true" />}
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}
