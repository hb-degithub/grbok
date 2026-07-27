import React from 'react';
import { useInsights } from '../../hooks/domains/useInsights';

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
 */

export default function InsightsDashboard() {
  const { stats, topPosts, loading, range, setRange } = useInsights();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-md bg-bg-soft" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card rounded-md p-6 text-center text-text-secondary">
        统计数据暂不可用
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 时间范围选择 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary">时间范围：</span>
        {(['7d', '30d', '90d'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              range === r
                ? 'bg-accent text-white'
                : 'bg-bg-soft text-text-secondary hover:bg-accent/10'
            }`}
          >
            {r === '7d' ? '最近 7 天' : r === '30d' ? '最近 30 天' : '最近 90 天'}
          </button>
        ))}
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card rounded-md p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">总浏览量</p>
          <p className="mt-1 text-2xl font-bold text-text">{stats.totalViews.toLocaleString()}</p>
        </div>
        <div className="card rounded-md p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">今日浏览</p>
          <p className="mt-1 text-2xl font-bold text-text">{stats.todayViews.toLocaleString()}</p>
        </div>
        <div className="card rounded-md p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">独立访客</p>
          <p className="mt-1 text-2xl font-bold text-text">{stats.uniqueVisitors.toLocaleString()}</p>
        </div>
        <div className="card rounded-md p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">平均每日</p>
          <p className="mt-1 text-2xl font-bold text-text">
            {stats.daily.length > 0
              ? Math.round(stats.totalViews / stats.daily.length).toLocaleString()
              : 0}
          </p>
        </div>
      </div>

      {/* 热门页面 */}
      <div className="card rounded-md p-4">
        <h3 className="mb-4 text-sm font-semibold text-text">热门页面</h3>
        {stats.topPages.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无数据</p>
        ) : (
          <div className="space-y-2">
            {stats.topPages.slice(0, 10).map((page, index) => (
              <div key={page.path} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-soft font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm text-text">{page.path}</span>
                </div>
                <span className="shrink-0 font-mono text-xs text-text-secondary">
                  {page.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 热门文章互动 */}
      <div className="card rounded-md p-4">
        <h3 className="mb-4 text-sm font-semibold text-text">热门文章互动</h3>
        {topPosts.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无数据</p>
        ) : (
          <div className="space-y-3">
            {topPosts.map((post, index) => (
              <div key={post.postId} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-soft font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-text">{post.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-xs text-text-secondary">
                  <span title="浏览量">{post.views} 浏览</span>
                  <span title="反应数">{post.reactions} 反应</span>
                  <span title="评论数">{post.comments} 评论</span>
                  <span className="font-mono font-semibold text-accent" title="互动分数">
                    {post.score} 分
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 来源统计 */}
      {stats.topReferrers.length > 0 && (
        <div className="card rounded-md p-4">
          <h3 className="mb-4 text-sm font-semibold text-text">来源统计</h3>
          <div className="space-y-2">
            {stats.topReferrers.slice(0, 10).map((ref, index) => (
              <div key={ref.referrer || 'direct'} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-soft font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm text-text">
                    {ref.referrer || '直接访问'}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs text-text-secondary">
                  {ref.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 设备统计 */}
      {stats.detail?.uaCategories && stats.detail.uaCategories.length > 0 && (
        <div className="card rounded-md p-4">
          <h3 className="mb-4 text-sm font-semibold text-text">设备统计</h3>
          <div className="space-y-2">
            {stats.detail.uaCategories.map((ua, index) => (
              <div key={ua.category} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-soft font-mono text-[10px] text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm text-text">{ua.category}</span>
                </div>
                <span className="shrink-0 font-mono text-xs text-text-secondary">
                  {ua.views.toLocaleString()} 次
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}