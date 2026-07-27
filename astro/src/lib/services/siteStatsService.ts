import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

interface StatsRecord extends RecordModel {
  [key: string]: unknown;
}

export interface SiteCounts {
  posts: number;
  tags: number;
  comments: number;
}

class SiteStatsService extends BaseService<StatsRecord> {
  constructor() {
    super('posts');
  }

  /**
   * 获取站点统计数据（文章、标签、评论数量）
   */
  async getSiteCounts(): Promise<SiteCounts> {
    const pb = this.getPocketBase();
    const [postsRes, tagsRes, commentsRes] = await Promise.all([
      pb.collection('posts').getList(1, 1, { filter: 'status = "published"' }),
      pb.collection('tags').getList(1, 1),
      pb.collection('comments').getList(1, 1, { filter: 'status = "approved"' }),
    ]);
    return {
      posts: postsRes.totalItems,
      tags: tagsRes.totalItems,
      comments: commentsRes.totalItems,
    };
  }
}

export const siteStatsService = new SiteStatsService();
