import React, { useState, useEffect, useCallback } from 'react';
import { getPocketBase } from '../../lib/pocketbase';

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

interface PageStat {
  path: string;
  views: number;
}

interface BlogStatsResponse {
  range: string;
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  daily: { date: string; views: number }[];
  topPages: PageStat[];
  topReferrers: { referrer: string; views: number }[];
  detail?: {
    uaCategories: { category: string; views: number }[];
  };
}

interface PostEngagement {
  postId: string;
  title: string;
  views: number;
  reactions: number;
  comments: number;
  score: number;
}

export default function InsightsDashboard() {
  const [stats, setStats] = useState<BlogStatsResponse | null>(null);
  const [engagement, setEngagement] = useState<PostEngagement[]>([]);
  const [totalReactions, setTotalReactions] = useState(0);
  const [totalComments, setTotalComments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('30d');
  const pb = getPocketBase();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // 1. 调用服务端聚合接口（COUNT(DISTINCT visitor_hash) 在服务端完成，不泄露原始哈希）
      const statsRes = await fetch(
        `${pb.baseUrl}/api/blog-stats?range=${timeRange}&detail=1`,
        { headers: pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {} }
      );
      if (!statsRes.ok) throw new Error(`blog-stats HTTP ${statsRes.status}`);
      const statsData: BlogStatsResponse = await statsRes.json();
      setStats(statsData);

      // 2. 并行拉取 reactions/comments/posts 用于互动聚合
      const [reactionsRes, commentsRes, postsRes] = await Promise.all([
        pb.collection('reactions').getList(1, 500, { sort: '-created' }).catch(() => ({ items: [] })),
        pb.collection('comments').getList(1, 500, { filter: 'status = "approved"', sort: '-created' }).catch(() => ({ items: [] })),
        pb.collection('posts').getList(1, 200, { filter: 'status = "published"', fields: 'id,title,slug' }).catch(() => ({ items: [] })),
      ]);

      setTotalReactions(reactionsRes.items.length);
      setTotalComments(commentsRes.items.length);

      // 3. 文章互动价值聚合（基于 topPages 的浏览量 + reactions/comments 计数）
      const postViews: Record<string, number> = {};
      for (const p of statsData.topPages) {
        if (p.path.startsWith('/posts/')) {
          const slug = p.path.replace('/posts/', '').replace(/\/$/, '');
          postViews[slug] = p.views;
        }
      }
      const reactionMap: Record<string, number> = {};
      for (const r of reactionsRes.items as any[]) {
        const pid = r.post_id;
        if (pid) reactionMap[pid] = (reactionMap[pid] || 0) + 1;
      }
      const commentMap: Record<string, number> = {};
      for (const c of commentsRes.items as any[]) {
        const pid = c.post_id;
        if (pid) commentMap[pid] = (commentMap[pid] || 0) + 1;
      }

      // 互动价值评分：浏览量权重 50%，反应(×5) + 评论(×10) 权重 50%
      const eng: PostEngagement[] = (postsRes.items as any[])
        .map((p) => {
          const v = postViews[p.slug] || 0;
          const r = reactionMap[p.id] || 0;
          const c = commentMap[p.id] || 0;
          return {
            postId: p.id,
            title: p.title,
            views: v,
            reactions: r,
            comments: c,
            score: v * 0.5 + (r * 5 + c * 10) * 0.5,
          };
        })
        .sort((a, b) => b.score - a.score);
      setEngagement(eng);
    } catch (err) {
      console.error('Insights load error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [pb, timeRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const topPages = stats?.topPages || [];
  const topPosts = engagement.slice(0, 10);
  const maxViews = Math.max(...topPages.map((p) => p.views), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">数据洞察</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">流量、互动与内容价值分析。仅后台可见。</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-1 dark:bg-zinc-900">
          {(['7d', '30d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                timeRange === r ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-text'
              }`}
            >
              {r === '7d' ? '近 7 天' : '近 30 天'}
            </button>
          ))}
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: '总浏览量', value: stats?.totalViews ?? 0, icon: '👁', color: 'text-blue-600' },
          { label: '今日浏览', value: stats?.todayViews ?? 0, icon: '📊', color: 'text-cyan-600' },
          { label: '独立访客', value: stats?.uniqueVisitors ?? 0, icon: '👤', color: 'text-violet-600' },
          { label: '已审评论', value: totalComments, icon: '💬', color: 'text-emerald-600' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-white p-5 shadow-sm dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-2xl" aria-hidden="true">{stat.icon}</span>
              <span className={`text-2xl font-black ${stat.color}`}>{stat.value}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* 错误态 */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">数据加载失败，请确认 PocketBase 服务正常且 /api/blog-stats 接口可用。</p>
          <button onClick={loadData} className="mt-2 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700">重试</button>
        </div>
      )}

      {/* 页面浏览排行 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm dark:bg-zinc-900">
        <h3 className="mb-4 text-sm font-bold text-zinc-950 dark:text-zinc-50">页面浏览 TOP 10</h3>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : topPages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">暂无浏览数据</p>
        ) : (
          <div className="space-y-2">
            {topPages.map((p, i) => (
              <div key={p.path} className="flex items-center gap-3">
                <span className="w-6 text-right text-xs font-mono text-zinc-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm text-text">{p.path}</span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">{p.views} 次</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 文章互动排行 */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm dark:bg-zinc-900">
        <h3 className="mb-4 text-sm font-bold text-zinc-950 dark:text-zinc-50">文章互动价值 TOP 10</h3>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : topPosts.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">暂无互动数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">文章</th>
                  <th className="px-3 py-2 text-right font-medium">浏览</th>
                  <th className="px-3 py-2 text-right font-medium">反应</th>
                  <th className="px-3 py-2 text-right font-medium">评论</th>
                  <th className="px-3 py-2 text-right font-medium">综合分</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topPosts.map((p, i) => (
                  <tr key={p.postId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-3 py-2 font-mono text-zinc-400">{i + 1}</td>
                    <td className="px-3 py-2 text-text">{p.title}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{p.views}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{p.reactions}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{p.comments}</td>
                    <td className="px-3 py-2 text-right font-semibold text-indigo-600 dark:text-indigo-400">{p.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
