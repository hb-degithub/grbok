import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface Comment {
  id: string;
  post: string;
  author_name: string;
  author_email?: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
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

export type CommentFilter = 'all' | 'pending' | 'approved' | 'rejected';

type CommentRecord = Comment & RecordModel;

class AdminCommentService extends BaseService<CommentRecord> {
  constructor() {
    super('comments');
  }

  async getComments(filter: CommentFilter = 'all', page = 1, perPage = 20): Promise<{ items: Comment[]; totalItems: number }> {
    const filterStr = filter === 'all' ? '' : `status = "${filter}"`;
    const result = await this.getList(page, perPage, {
      filter: filterStr,
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

  async rejectComment(id: string): Promise<void> {
    await this.update(id, { status: 'rejected' });
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
