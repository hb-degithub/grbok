import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface DashboardStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalComments: number;
  pendingComments: number;
  totalTags: number;
  totalUsers: number | null;
}

export interface RecentPost {
  id: string;
  title: string;
  status: string;
  updated: string;
}

export interface RecentComment {
  id: string;
  author_name: string;
  content: string;
  status: string;
  created: string;
}

class AdminDashboardService extends BaseService<RecordModel> {
  constructor() {
    super('posts');
  }

  async getStats(canReadUsers: boolean): Promise<DashboardStats> {
    const pb = this.getPocketBase();
    const [posts, published, drafts, comments, pending, tags, users] = await Promise.all([
      pb.collection('posts').getList(1, 1),
      pb.collection('posts').getList(1, 1, { filter: 'status = "published"' }),
      pb.collection('posts').getList(1, 1, { filter: 'status = "draft"' }),
      pb.collection('comments').getList(1, 1),
      pb.collection('comments').getList(1, 1, { filter: 'status = "pending"' }),
      pb.collection('tags').getList(1, 1),
      canReadUsers ? pb.collection('users').getList(1, 1) : Promise.resolve(null),
    ]);

    return {
      totalPosts: posts.totalItems,
      publishedPosts: published.totalItems,
      draftPosts: drafts.totalItems,
      totalComments: comments.totalItems,
      pendingComments: pending.totalItems,
      totalTags: tags.totalItems,
      totalUsers: users?.totalItems ?? null,
    };
  }

  async getRecentPosts(): Promise<RecentPost[]> {
    const pb = this.getPocketBase();
    const result = await pb.collection('posts').getList(1, 5, {
      sort: '-updated',
      fields: 'id,title,status,updated',
    });
    return result.items as unknown as RecentPost[];
  }

  async getRecentComments(): Promise<RecentComment[]> {
    const pb = this.getPocketBase();
    const result = await pb.collection('comments').getList(1, 5, {
      sort: '-created',
      fields: 'id,author_name,content,status,created',
    });
    return result.items as unknown as RecentComment[];
  }
}

export const adminDashboardService = new AdminDashboardService();