import { useState, useEffect, useCallback } from 'react';
import { insightsService, type BlogStatsResponse, type PostEngagement } from '../../lib/services/insightsService';

export function useInsights() {
  const [stats, setStats] = useState<BlogStatsResponse | null>(null);
  const [topPosts, setTopPosts] = useState<PostEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, topPostsData] = await Promise.all([
        insightsService.getBlogStats(range),
        insightsService.getTopPosts(10),
      ]);
      setStats(statsData);
      setTopPosts(topPostsData);
    } catch (err) {
      console.error('获取统计数据失败：', err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    topPosts,
    loading,
    range,
    setRange,
    refresh: fetchStats,
  };
}