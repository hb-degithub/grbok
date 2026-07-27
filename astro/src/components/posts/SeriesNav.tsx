/**
 * 文章系列导航组件 —— 基于 PocketBase settings 表存储系列映射。
 *
 * settings 表中 key 格式：series:{seriesId}，value 为 JSON 数组：
 * [{ "slug": "post-1", "title": "第一篇", "order": 1 }, ...]
 *
 * 用法（在文章页 [slug].astro 中追加，不修改现有 DOM）：
 * <SeriesNav client:visible seriesId={post.expand?.series?.id} />
 */

import { useSeries } from '../../hooks/domains/useSeries';

export default function SeriesNav({ seriesId, currentSlug }: { seriesId: string; currentSlug?: string }) {
  const { entries, loading } = useSeries(seriesId);

  if (loading || !entries.length) return null;

  return (
    <nav className="series-nav my-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-label="系列文章">
      <h3 className="mb-3 text-sm font-bold text-zinc-950 dark:text-zinc-50">系列文章</h3>
      <ol className="space-y-1.5">
        {entries.map((entry, i) => {
          const isCurrent = entry.slug === currentSlug;
          return (
            <li key={entry.slug}>
              <a
                href={`/posts/${entry.slug}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent
                    ? 'text-sm font-semibold text-teal-600 dark:text-teal-400'
                    : 'text-sm text-zinc-600 hover:text-teal-600 hover:underline dark:text-zinc-400 dark:hover:text-teal-400'
                }
              >
                {i + 1}. {entry.title}
                {isCurrent && <span className="ml-1.5 text-xs text-teal-500">（当前）</span>}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}