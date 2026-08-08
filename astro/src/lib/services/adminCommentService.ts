import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface Comment {
  id: string;
  post: string;
  author_name: string;
  author_email?: string;
  content: string;
  status: 'pending' | 'approved' | 'spam';
  created: string;
  updated: string;
  expand?: {
    post?: {
      id: string;
      title: string;
      slug: string;
    };
  };
}

export type CommentFilter = 'all' | 'pending' | 'approved' | 'spam';

type CommentRecord = Comment & RecordModel;

class AdminCommentService extends BaseService<CommentRecord> {
  constructor() {
    super('comments');
  }

  async getComments(filter: CommentFilter = 'all', page = 1, perPage = 20, query = ''): Promise<{ items: Comment[]; totalItems: number }> {
    const conditions: string[] = [];
    if (filter !== 'all') conditions.push(`status = "${filter}"`);
    if (query) {
      const escaped = query.replace(/["\\]/g, '');
      conditions.push(`(author_name ~ "${escaped}" || author_email ~ "${escaped}" || content ~ "${escaped}" || post_id.title ~ "${escaped}")`);
    }
    const result = await this.getList(page, perPage, {
      filter: conditions.join(' && '),
      sort: '-created',
      expand: 'post',
    });
    return {
      items: result.items as unknown as Comment[],
      totalItems: result.totalItems,
    };
  }

  async approveComment(id: string): Promise<void> {
    await this.update(id, { status: 'approved' });
  }

  async markSpam(id: string): Promise<void> {
    await this.update(id, { status: 'spam' });
  }

  async updateStatus(id: string, status: Comment['status']): Promise<void> {
    await this.update(id, { status });
  }

  async batchUpdateStatus(ids: string[], status: Comment['status']): Promise<void> {
    const pb = this.getPocketBase();
    for (const id of ids) {
      await pb.collection('comments').update(id, { status });
    }
  }

  async batchDelete(ids: string[]): Promise<void> {
    const pb = this.getPocketBase();
    for (const id of ids) {
      await pb.collection('comments').delete(id);
    }
  }

  async deleteComment(id: string): Promise<void> {
    await this.delete(id);
  }

  async getPendingCount(): Promise<number> {
    const pb = this.getPocketBase();
    const result = await pb.collection('comments').getList(1, 1, {
      filter: 'status = "pending"',
    });
    return result.totalItems;
  }
}

export const adminCommentService = new AdminCommentService();
