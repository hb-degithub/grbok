import { useState, useEffect } from 'react';
import { siteStatsService, type SiteCounts } from '../../lib/services/siteStatsService';

interface Stat {
  label: string;
  value: string;
}

/**
 * 站点统计 Hook - 用于 ProfileCard 显示文章、标签、评论数量
 */
export function useSiteCounts() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<Stat[]>([
    { label: '文章', value: '-' },
    { label: '标签', value: '-' },
    { label: '评论', value: '-' },
  ]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const counts = await siteStatsService.getSiteCounts();
        setStats([
          { label: '文章', value: String(counts.posts) },
          { label: '标签', value: String(counts.tags) },
          { label: '评论', value: String(counts.comments) },
        ]);
        setMounted(true);
      } catch (err) {
        console.error('加载统计数据失败:', err);
        setMounted(true);
      }
    };
    fetchStats();
  }, []);

  return { stats, mounted };
}
