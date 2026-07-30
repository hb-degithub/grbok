import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface PageStat {
  path: string;
  views: number;
}

export interface BlogStatsResponse {
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
  geo?: {
    countries: { country: string; views: number; uniqueVisitors: number }[];
    regions: { country: string; region: string; city: string; views: number; uniqueVisitors: number }[];
  };
}

export interface PostEngagement {
  postId: string;
  title: string;
  views: number;
  reactions: number;
  comments: number;
  score: number;
}

export interface Reaction {
  id: string;
  post_id: string;
  type: string;
  created: string;
}

type ReactionRecord = Reaction & RecordModel;

class InsightsService extends BaseService<ReactionRecord> {
  constructor() {
    super('reactions');
  }

  async getBlogStats(range: string = '7d'): Promise<BlogStatsResponse> {
    const pb = this.getPocketBase();
    
    // 验证 range 参数，防止注入
    const ALLOWED_RANGES = ['24h', '7d', '30d', '90d', '1y'];
    const safeRange = ALLOWED_RANGES.includes(range) ? range : '7d';
    
    return pb.send<BlogStatsResponse>(`/api/blog-stats?range=${safeRange}`, {
      method: 'GET',
    });
  }

  async getPostEngagement(postIds: string[]): Promise<PostEngagement[]> {
    const pb = this.getPocketBase();
    
    // 验证 PocketBase ID 格式（15 位字母数字）
    const ID_RE = /^[a-z0-9]{15}$/;
    const safeIds = postIds.filter(id => ID_RE.test(id));
    
    if (safeIds.length === 0) {
      return [];
    }
    
    // 构建参数化 filter
    const buildIdFilter = (field: string) => {
      return safeIds.map((id, i) => {
        const key = `id${i}`;
        return pb.filter(`${field} = {:${key}}`, { [key]: id });
      }).join(' || ');
    };
    
    // 获取文章信息
    const postsResult = await pb.collection('posts').getList(1, 100, {
      filter: buildIdFilter('id'),
      fields: 'id,title,views',
    });
    
    // 获取反应统计
    const reactionsResult = await pb.collection('reactions').getList(1, 500, {
      filter: buildIdFilter('post_id'),
    });
    
    // 获取评论统计
    const commentsResult = await pb.collection('comments').getList(1, 500, {
      filter: buildIdFilter('post_id') + ' && status = "approved"',
    });
    
    // 计算每个文章的互动分数
    const engagementMap = new Map<string, PostEngagement>();
    
    postsResult.items.forEach(post => {
      engagementMap.set(post.id, {
        postId: post.id,
        title: post.title,
        views: post.views || 0,
        reactions: 0,
        comments: 0,
        score: 0,
      });
    });
    
    reactionsResult.items.forEach(reaction => {
      const engagement = engagementMap.get(reaction.post_id);
      if (engagement) {
        engagement.reactions++;
      }
    });
    
    commentsResult.items.forEach(comment => {
      const engagement = engagementMap.get(comment.post_id);
      if (engagement) {
        engagement.comments++;
      }
    });
    
    // 计算分数：浏览量 * 1 + 反应数 * 3 + 评论数 * 5
    engagementMap.forEach(engagement => {
      engagement.score = engagement.views * 1 + engagement.reactions * 3 + engagement.comments * 5;
    });
    
    return Array.from(engagementMap.values())
      .sort((a, b) => b.score - a.score);
  }

  async getTopPosts(limit: number = 10): Promise<PostEngagement[]> {
    const pb = this.getPocketBase();
    
    // 获取所有已发布文章
    const postsResult = await pb.collection('posts').getList(1, 200, {
      filter: 'status = "published"',
      fields: 'id',
    });
    
    const postIds = postsResult.items.map(p => p.id);
    const engagements = await this.getPostEngagement(postIds);
    
    return engagements.slice(0, limit);
  }
}

export const insightsService = new InsightsService();