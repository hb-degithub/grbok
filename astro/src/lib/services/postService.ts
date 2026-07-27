import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { Post } from '../../types/pocketbase';

// Post 已经包含 id 字段，不需要再继承 RecordModel
type PostRecord = Post & RecordModel;

class PostService extends BaseService<PostRecord> {
  constructor() {
    super('posts');
  }

  /**
   * 获取热门文章
   */
  async getHotPosts(limit: number = 5): Promise<Post[]> {
    const result = await this.getList(1, limit, {
      filter: 'status = "published"',
      sort: '-views',
      fields: 'id,title,slug,cover,views,created',
    });
    return result.items;
  }

  /**
   * 获取已发布文章列表
   */
  async getPublishedPosts(page: number = 1, perPage: number = 10): Promise<{ items: Post[]; totalItems: number }> {
    const result = await this.getList(page, perPage, {
      filter: 'status = "published"',
      sort: '-created',
    });
    return { items: result.items, totalItems: result.totalItems };
  }
}

export const postService = new PostService();
