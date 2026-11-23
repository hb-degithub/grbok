import React from 'react';
import { useInsights } from '../../hooks/domains/useInsights';
import type { PostEngagement } from '../../lib/services/insightsService';

/**
 * 数据看板增强组件 -- 超管后台新增模块。
 *
 * 路由：/admin/insights/
 * 权限：admin+
 * 依赖文件：pb_hooks/stats_track.pb.js（/api/blog-stats 聚合接口）,
 *           reactions, comments, posts collections
 *
 * 资产保护：纯后台展示，不嵌入前端页面。
 * 数据来源：PocketBase /api/blog-stats 聚合接口（服务端 COUNT(DISTINCT)）+
 *           reactions/comments 聚合。
 *
 * ⚠️ 此看板数据仅后台展示，严禁在前端渲染（遵守展示层判定协议）。
 * 隐私：不读取 visitor_hash 原始值，uniqueVisitors 由服务端 SQL 聚合返回。
 *
 * 容错（2026-11 生产缺陷回归）：
 * reactions 集合匿名不可读（403 Only admins），旧实现让 `Promise.all` 整体 reject，
 * 页面永远停在「统计数据暂不可用」。现在统计接口与互动排行分别收敛：
 * - 互动数据降级 → 顶部一句 `部分互动数据不可用`，其余照常渲染；
 * - 统计接口降级 → 仍然渲染互动排行，不给整页空白。
 *
 * 视觉：表面色 + 冷灰细线 + 3px 圆角；数字等宽 + tabular-nums；
 * 排名行用序号 + 细线分隔，不再使用色块与阴影。
 */

const PANEL =
  'min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const PANEL_HEAD =
  'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2';
const ROW = 'border-b border-[var(--sf-line-soft)] last:border-b-0';
const INDEX = 'w-6 shrink-0 font-mono text-[10px] tabular-nums tracking-[0.14em] text-[var(--sf-ink-3)]';

const RANGE_ON = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]';
const RANGE_OFF =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

function Section({
  index,
  title,
  hint,
  children,
  bodyClassName,
}: {
  index: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={PANEL}>
      <div className={PANEL_HEAD}>
        <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">{index}</span>
        <h3 className="text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]">{title}</h3>
        <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
        {hint && <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">{hint}</span>}
      </div>
      <div className={bodyClassName ?? 'px-3 py-2.5'}>{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={`${PANEL} px-3 py-2.5`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">{label}</p>
      <p className="mt-1.5 font-mono text-2xl font-bold leading-none tracking-tight tabular-nums text-[var(--sf-ink)] [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="px-3 py-3 text-sm text-[var(--sf-ink-3)]">{text}</p>
  );
}

/** 降级提示：一行细线说明，不打断阅读，也不冒充错误（role=status 而非 alert）。 */
function PartialNote({ text }: { text: string }) {
  return (
    <p
      role="status"
      data-state="partial"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-[var(--sf-ink-3)]"
    >
      <span className="h-1 w-1 shrink-0 bg-[var(--sf-accent)]" aria-hidden="true" />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}

function TopPostsList({ posts }: { posts: PostEngagement[] }) {
  if (posts.length === 0) return <EmptyNote text="暂无数据" />;
  return (
    <div>
      {posts.map((post, index) => (
        <div key={post.postId} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 ${ROW}`}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className={INDEX}>{String(index + 1).padStart(2, '0')}</span>
            <span className="truncate text-sm font-medium text-[var(--sf-ink)]">{post.title}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-[var(--sf-ink-3)]">
            <span title="浏览量">{post.views} 浏览</span>
            <span title="反应数">{post.reactions} 反应</span>
            <span title="评论数">{post.comments} 评论</span>
            <span className="font-semibold text-[var(--sf-accent)]" title="互动分数">
              {post.score} 分
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RangeSelector({
  range,
  setRange,
}: {
  range: '7d' | '30d' | '90d';
  setRange: (next: '7d' | '30d' | '90d') => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">时间范围：</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="时间范围">
        {(['7d', '30d', '90d'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`min-h-8 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${range === r ? RANGE_ON : RANGE_OFF}`}
          >
            {r === '7d' ? '最近 7 天' : r === '30d' ? '最近 30 天' : '最近 90 天'}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function InsightsDashboard() {
  const { stats, topPosts, loading, range, setRange, partial, availability } = useInsights();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]" />
      </div>
    );
  }

  // 两个数据源都拿不到才真的没有可展示内容；只有一个降级时仍要渲染另一部分。
  if (!stats && topPosts.length === 0) {
    return (
      <div className={`${PANEL} px-4 py-6 text-center text-sm text-[var(--sf-ink-2)]`}>
        统计数据暂不可用
      </div>
    );
  }

  // 统计接口不可用，但互动排行还在：渲染可用的部分，而不是整页空白。
  if (!stats) {
    return (
      <div className="space-y-4" data-state="partial">
        <RangeSelector range={range} setRange={setRange} />
        <PartialNote text="统计数据接口暂不可用，以下仅展示文章互动排行。" />
        <Section index="01" title="热门文章互动" hint={`${topPosts.length} 篇`} bodyClassName="px-0 py-0">
          <TopPostsList posts={topPosts} />
        </Section>
      </div>
    );
  }

  const averageDaily = stats.daily.length > 0
    ? Math.round(stats.totalViews / stats.daily.length).toLocaleString()
    : 0;

  // 来源/设备区块在无数据时整块隐藏，序号按实际渲染顺序顺延，避免出现 01、02、04 的跳号。
  const uaCategories = stats.detail?.uaCategories ?? [];
  const hasReferrers = stats.topReferrers.length > 0;
  const hasDevices = uaCategories.length > 0;
  // 序号由「前面已渲染的区块数」直接算出，不用自增游标：
  // 来源存在时占 03、设备顺延 04；来源为空时设备直接是 03；都不渲染则不占号。
  const SECTION_START = 3;
  const referrerIndex = hasReferrers ? String(SECTION_START).padStart(2, '0') : '';
  const deviceIndex = hasDevices
    ? String(SECTION_START + (hasReferrers ? 1 : 0)).padStart(2, '0')
    : '';

  // 反应/评论计数不可读时只提示一次，且不声称「统计不可用」——其余数字是真的。
  const interactionsDegraded = !availability.reactions || !availability.comments;
  const degradedParts = [
    !availability.reactions ? '反应' : '',
    !availability.comments ? '评论' : '',
  ].filter(Boolean).join('/');

  return (
    <div className="space-y-4" data-state={partial ? 'partial' : 'ready'}>
      <RangeSelector range={range} setRange={setRange} />

      {interactionsDegraded && (
        <PartialNote text={`部分互动数据不可用（${degradedParts}计数按 0 显示），浏览量、访客、热门页面与来源统计不受影响。`} />
      )}

      {/* 统计指标 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="总浏览量" value={stats.totalViews.toLocaleString()} />
        <Metric label="今日浏览" value={stats.todayViews.toLocaleString()} />
        <Metric label="独立访客" value={stats.uniqueVisitors.toLocaleString()} />
        <Metric label="平均每日" value={averageDaily} />
      </div>

      {/* 热门页面 */}
      <Section index="01" title="热门页面" hint={`${stats.topPages.length} 页`} bodyClassName="px-0 py-0">
        {stats.topPages.length === 0 ? (
          <EmptyNote text="暂无数据" />
        ) : (
          <div>
            {stats.topPages.slice(0, 10).map((page, index) => (
              <div key={page.path} className={`flex items-center justify-between gap-3 px-3 py-2 ${ROW}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={INDEX}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="truncate text-sm text-[var(--sf-ink)]">{page.path}</span>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--sf-ink-3)]">
                  {page.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 热门文章互动 */}
      <Section index="02" title="热门文章互动" hint={`${topPosts.length} 篇`} bodyClassName="px-0 py-0">
        <TopPostsList posts={topPosts} />
      </Section>

      {/* 来源统计 */}
      {hasReferrers && (
        <Section index={referrerIndex} title="来源统计" hint={`${stats.topReferrers.length} 个`} bodyClassName="px-0 py-0">
          <div>
            {stats.topReferrers.slice(0, 10).map((ref, index) => (
              <div key={ref.referrer || 'direct'} className={`flex items-center justify-between gap-3 px-3 py-2 ${ROW}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={INDEX}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="truncate text-sm text-[var(--sf-ink)]">
                    {ref.referrer || '直接访问'}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--sf-ink-3)]">
                  {ref.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 设备统计 */}
      {hasDevices && (
        <Section index={deviceIndex} title="设备统计" hint={`${uaCategories.length} 类`} bodyClassName="px-0 py-0">
          <div>
            {uaCategories.map((ua, index) => (
              <div key={ua.category} className={`flex items-center justify-between gap-3 px-3 py-2 ${ROW}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={INDEX}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="truncate text-sm text-[var(--sf-ink)]">{ua.category}</span>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--sf-ink-3)]">
                  {ua.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
