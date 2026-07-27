import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

/**
 * 统计数据接口
 */
export interface StatsData {
  range: string;
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  daily: Array<{ date: string; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
  detail?: { uaCategories: Array<{ category: string; views: number }> };
  geo?: {
    countries: Array<{ country: string; views: number; uniqueVisitors: number }>;
    regions: Array<{ country: string; region: string; city: string; views: number; uniqueVisitors: number }>;
  };
}

interface StatsRecord extends RecordModel {
  [key: string]: unknown;
}

/**
 * 统计服务
 * 封装统计数据相关的 API 调用
 */
class StatsService extends BaseService<StatsRecord> {
  constructor() {
    super('stats');
  }

  /**
   * 获取博客统计数据
   * @param variant 变体类型：public（公开）或 admin（管理后台）
   */
  async getBlogStats(variant: 'public' | 'admin' = 'public'): Promise<StatsData> {
    const query = variant === 'admin'
      ? { range: '30d', detail: '1', geo: '1' }
      : { range: '30d' };

    return this.send<StatsData>('/api/blog-stats', {
      method: 'GET',
      query,
    });
  }
}

export const statsService = new StatsService();
