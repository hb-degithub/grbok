import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

interface Policy {
  key: string;
  limit: number;
  windowSeconds: number;
}

interface Bucket {
  key: string;
  count?: number;
  lastTriggered?: string;
  locked?: boolean;
  lockUntil?: string;
}

interface Stats {
  comments?: number;
  pendingComments?: number;
  reports?: number;
  pendingReports?: number;
}

interface SecurityEvent {
  id: string;
  action: string;
  actor: string;
  target: string;
  detail: string;
  created: string;
}

interface SecurityStatusData {
  policies: Policy[];
  buckets: Bucket[];
  stats: Stats;
  timestamp: string;
}

export default function SecurityStatus() {
  const [data, setData] = useState<SecurityStatusData | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pb = getPocketBase();
        const [statusRes, eventsRes] = await Promise.all([
          pb.send<SecurityStatusData>('/api/blog-admin/security/status', { method: 'GET' }),
          pb.send<{ events: SecurityEvent[] }>('/api/blog-admin/security/events', { method: 'GET' }),
        ]);
        setData(statusRes);
        setEvents(eventsRes.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="card rounded-xl p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card rounded-xl p-5">
        <p className="text-sm text-red-500">加载防护状态失败：{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const activeBuckets = data.buckets.filter(b => !b.locked);
  const lockedBuckets = data.buckets.filter(b => b.locked);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-zinc-900 dark:text-zinc-50">{data.stats.comments ?? 0}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">总评论数</p>
        </div>
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{data.stats.pendingComments ?? 0}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">待审核评论</p>
        </div>
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-zinc-900 dark:text-zinc-50">{data.stats.reports ?? 0}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">总举报数</p>
        </div>
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-red-600 dark:text-red-400">{data.stats.pendingReports ?? 0}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">待处理举报</p>
        </div>
      </div>

      {/* 限流策略 */}
      <div className="card rounded-xl p-5">
        <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">限流策略</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="pb-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">策略</th>
                <th className="pb-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">限制</th>
                <th className="pb-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">窗口</th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map((p) => (
                <tr key={p.key} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{p.key}</td>
                  <td className="py-2 text-zinc-900 dark:text-zinc-100">{p.limit} 次</td>
                  <td className="py-2 text-zinc-500 dark:text-zinc-400">{p.windowSeconds} 秒</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 活跃限流桶 */}
      {activeBuckets.length > 0 && (
        <div className="card rounded-xl p-5">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">活跃限流</h3>
          <div className="space-y-2">
            {activeBuckets.map((b) => (
              <div key={b.key} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{b.key}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {b.count} 次 · {b.lastTriggered ? new Date(b.lastTriggered).toLocaleString('zh-CN') : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 锁定状态 */}
      {lockedBuckets.length > 0 && (
        <div className="card rounded-xl border-red-200 p-5 dark:border-red-800">
          <h3 className="mb-4 text-sm font-semibold text-red-700 dark:text-red-400">当前锁定</h3>
          <div className="space-y-2">
            {lockedBuckets.map((b) => (
              <div key={b.key} className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/20">
                <span className="font-mono text-xs text-red-700 dark:text-red-400">{b.key}</span>
                <span className="text-xs text-red-500 dark:text-red-400">
                  锁定至 {b.lockUntil ? new Date(b.lockUntil).toLocaleString('zh-CN') : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近安全事件 */}
      {events.length > 0 && (
        <div className="card rounded-xl p-5">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">最近安全事件</h3>
          <div className="space-y-2">
            {events.map((e) => (
              <div key={e.id} className="rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{e.action}</span>
                  <span className="text-xs text-zinc-400">{new Date(e.created).toLocaleString('zh-CN')}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {e.actor} → {e.target}
                </p>
                {e.detail && <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{e.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        最后更新：{new Date(data.timestamp).toLocaleString('zh-CN')}
      </p>
    </motion.div>
  );
}
