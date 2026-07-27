import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { Comment } from '../../types/pocketbase';

// Comment 已经包含 id 字段，与 RecordModel 兼容
type CommentRecord = Comment & RecordModel;

class CommentSidebarService extends BaseService<CommentRecord> {
  constructor() {
    super('comments');
  }

  /**
   * 获取最近的已审核评论
   */
  async getRecentApproved(limit: number = 5): Promise<Comment[]> {
    const pb = this.getPocketBase();
    const result = await pb.collection('comments').getList<Comment>(1, limit, {
      filter: pb.filter('status = {:status}', { status: 'approved' }),
      sort: '-created',
      fields: 'id,author_name,content,post_id,created',
    });
    return result.items;
  }
}

export const commentSidebarService = new CommentSidebarService();
