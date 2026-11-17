import React from 'react';
import { useRecentComments } from '../../hooks/domains/useRecentComments';
import { sanitizeText } from '../../lib/security';

/**
 * 首页最近评论：编号行列表（等宽序号 + 作者 + 纯文本摘要），保留 useRecentComments 真实数据。
 * 视觉迁移到 --sf-* 令牌，去掉 AnimatedList、玻璃与入场动效；内容仍经 sanitizeText。
 */
export default function RecentComments() {
  const { comments, loading } = useRecentComments(5);

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--sf-line-soft)] pb-2">
        <h3 className="text-sm font-semibold tracking-[0.05em] text-[var(--sf-ink)]">最近评论</h3>
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">RECENT / 05</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-[1px] bg-[var(--sf-line-soft)]" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="py-2 text-sm text-[var(--sf-ink-3)]">暂无评论</p>
      ) : (
        <ol className="divide-y divide-[var(--sf-line-soft)]" role="list">
          {comments.map((comment, index) => (
            <li key={comment.id} className="flex min-h-[44px] items-start gap-3 py-2.5">
              <span className="mt-0.5 w-6 shrink-0 font-mono text-[0.6875rem] tabular-nums text-[var(--sf-ink-3)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[var(--sf-ink)]">{comment.author_name}</p>
                <p className="line-clamp-2 text-xs leading-relaxed text-[var(--sf-ink-2)]">
                  {sanitizeText(comment.content)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
