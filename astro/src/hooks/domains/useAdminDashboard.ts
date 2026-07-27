import { useState, useEffect, useCallback } from 'react';
import { adminDashboardService, type DashboardStats, type RecentPost, type RecentComment } from '../../lib/services/adminDashboardService';
import { useAdminAuth, type AdminRole } from '../useAdminAuth';

export function useAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  const [recentComments, setRecentComments] = useState<RecentComment[]>([]);
  const { hasPermission, user } = useAdminAuth();
  const role = user?.role as AdminRole | undefined;
  const canReadUsers = role === 'super_admin';

  useEffect(() => {
    async function fetchStats() {
      if (!role) return;
      try {
        const data = await adminDashboardService.getStats(canReadUsers);
        setStats(data);
      } catch (err) {
        console.error('获取统计数据失败：', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [role, canReadUsers]);

  useEffect(() => {
    adminDashboardService.getRecentPosts().then(setRecentPosts).catch(() => {});
    adminDashboardService.getRecentComments().then(setRecentComments).catch(() => {});
  }, []);

  const publishRate = stats && stats.totalPosts > 0 ? Math.round((stats.publishedPosts / stats.totalPosts) * 100) : 0;
  const reviewRate = stats && stats.totalComments > 0 ? Math.round(((stats.totalComments - stats.pendingComments) / stats.totalComments) * 100) : 100;

  return {
    stats,
    loading,
    recentPosts,
    recentComments,
    role,
    hasPermission,
    user,
    publishRate,
    reviewRate,
  };
}