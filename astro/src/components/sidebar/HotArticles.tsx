import React from 'react';
import { useHotPosts } from '../../hooks/domains/useHotPosts';

/**
 * 首页热门文章：编号行列表（等宽序号 + 冷灰细线），保留 useHotPosts 真实数据。
 * 视觉迁移到 --sf-* 令牌，去掉 AnimatedList、玻璃与入场动效。
 */
export default function HotArticles() {
  const { posts, loading } = useHotPosts(5);

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--sf-line-soft)] pb-2">
        <h3 className="text-sm font-semibold tracking-[0.05em] text-[var(--sf-ink)]">热榜文章</h3>
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">HOT / 05</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-[1px] bg-[var(--sf-line-soft)]" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="py-2 text-sm text-[var(--sf-ink-3)]">暂无热门文章</p>
      ) : (
        <ol className="divide-y divide-[var(--sf-line-soft)]" role="list">
          {posts.map((post, index) => (
            <li key={post.id}>
              <a
                href={`/posts/${post.slug}`}
                className="group flex min-h-[44px] items-start gap-3 py-2.5 no-underline"
              >
                <span className="mt-0.5 w-6 shrink-0 font-mono text-[0.6875rem] tabular-nums text-[var(--sf-ink-3)] transition-colors group-hover:text-[var(--sf-accent)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm font-medium leading-snug text-[var(--sf-ink)] transition-colors group-hover:text-[var(--sf-accent)]">
                    {post.title}
                  </span>
                  <span className="mt-1 block font-mono text-[0.625rem] uppercase tracking-[0.12em] text-[var(--sf-ink-3)]">
                    {post.views || 0} 人已阅读
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
