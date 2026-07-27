import { useState, useEffect, useCallback } from 'react';
import { statsService, type StatsData } from '../../lib/services/statsService';

interface UseStatsOptions {
  /** 变体类型：public（公开）或 admin（管理后台） */
  variant?: 'public' | 'admin';
  /** 是否自动获取数据 */
  autoFetch?: boolean;
}

interface UseStatsReturn {
  data: StatsData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * 统计数据管理 Hook
 * 封装统计数据的获取和状态管理
 */
export function useStats(options: UseStatsOptions = {}): UseStatsReturn {
  const { variant = 'public', autoFetch = true } = options;

  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await statsService.getBlogStats(variant);
      setData(result);
    } catch (err) {
      console.error('获取统计数据失败：', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [variant]);

  useEffect(() => {
    if (autoFetch) {
      fetchStats();
    }
  }, [autoFetch, fetchStats]);

  return {
    data,
    loading,
    error,
    refetch: fetchStats,
  };
}
