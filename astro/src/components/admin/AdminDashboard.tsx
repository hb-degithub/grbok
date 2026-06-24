import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import StatsCard from './StatsCard';

interface DashboardStats {
  totalPosts: number; publishedPosts: number; draftPosts: number;
  totalComments: number; pendingComments: number;
  totalTags: number; totalUsers: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const pb = getPocketBase();
      try {
        const [posts, published, drafts, comments, pending, tags, users] = await Promise.all([
          pb.collection('posts').getList(1, 1),
          pb.collection('posts').getList(1, 1, { filter: 'status = "published"' }),
          pb.collection('posts').getList(1, 1, { filter: 'status = "draft"' }),
          pb.collection('comments').getList(1, 1),
          pb.collection('comments').getList(1, 1, { filter: 'status = "pending"' }),
          pb.collection('tags').getList(1, 1),
          pb.collection('users').getList(1, 1),
        ]);
        setStats({
          totalPosts: posts.totalItems, publishedPosts: published.totalItems, draftPosts: drafts.totalItems,
          totalComments: comments.totalItems, pendingComments: pending.totalItems,
          totalTags: tags.totalItems, totalUsers: users.totalItems,
        });
      } catch (err) { console.error('Failed to fetch stats:', err); }
      finally { setLoading(false); }
    }
    fetchStats();
  }, []);

  if (loading) return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-28 animate-pulse rounded-xl" />)}
    </div>
  );

  if (!stats) return <div className="card rounded-xl p-8 text-center text-text-secondary">Failed to load stats.</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Total Posts" value={stats.totalPosts} color="cyan" icon="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" trend={stats.publishedPosts + ' published'} />
        <StatsCard label="Comments" value={stats.totalComments} color="amber" icon="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" trend={stats.pendingComments + ' pending'} />
        <StatsCard label="Tags" value={stats.totalTags} color="emerald" icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        <StatsCard label="Users" value={stats.totalUsers} color="red" icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </div>
      {stats.pendingComments > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 rounded-xl border-warning/30 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <svg className="h-5 w-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <div>
            <p className="font-medium text-text">{stats.pendingComments} comment(s) awaiting moderation</p>
            <a href="/admin/comments" className="text-sm text-accent hover:underline">Review now</a>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
