import { useState, useEffect, useCallback } from 'react';
import {
  insightsService,
  type BlogStatsResponse,
  type InsightsSnapshot,
  type PostEngagement,
} from '../../lib/services/insightsService';

/** 数据源可用性：stats=false 时页面仍可用 topPosts 渲染，不再整页空白。 */
export type InsightsAvailability = InsightsSnapshot['availability'];

const EMPTY_AVAILABILITY: InsightsAvailability = {
  stats: false,
  posts: false,
  reactions: false,
  comments: false,
};

export function useInsights() {
  const [stats, setStats] = useState<BlogStatsResponse | null>(null);
  const [topPosts, setTopPosts] = useState<PostEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [availability, setAvailability] = useState<InsightsAvailability>(EMPTY_AVAILABILITY);
  const [partial, setPartial] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      // 服务内部已用 Promise.allSettled 收敛两个数据源，这里拿到的一定是可渲染快照：
      // 统计接口挂了仍有互动排行，reactions 403 只把反应计数降级为 0。
      const snapshot = await insightsService.getInsightsSnapshot(range, 10);
      setStats(snapshot.stats);
      setTopPosts(snapshot.topPosts);
      setAvailability(snapshot.availability);
      setPartial(snapshot.partial);
    } catch (err) {
      // 兜底：聚合层理论上不抛错，只有意料之外的异常才会到这里。
      console.error('获取统计数据失败：', err);
      setPartial(true);
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
    availability,
    partial,
    refresh: fetchStats,
  };
}
