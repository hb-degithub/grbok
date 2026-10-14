import { BaseService } from './baseService';
import { actionRequestHeaders } from './actionRequest';
import type { RecordModel } from 'pocketbase';
import type { Post } from '../../types/pocketbase';

// Post 已经包含 id 字段，不需要再继承 RecordModel
type PostRecord = Post & RecordModel;

/** 点赞/收藏接口的返回体（服务端 pb_hooks/lib/post_actions_lib.js） */
export interface PostActionResponse {
  ok: boolean;
  likes?: number;
  alreadyLiked?: boolean;
  removed?: boolean;
  bookmarked?: boolean;
  count?: number;
  alreadyBookmarked?: boolean;
  /** 是否收到浏览器指纹头（辅助信号，非授权依据） */
  fingerprintSeen?: boolean;
  fingerprintSource?: 'header' | 'absent';
  /** 实际生效的限流维度：user = 新策略；ip-fallback = 策略行缺失时的降级 */
  limitSource?: 'user' | 'ip-fallback';
  anomaly?: boolean;
}

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

  /**
   * 点赞文章（需登录；服务端按用户 id 去重，重复请求返回 alreadyLiked）
   */
  async likePost(postId: string): Promise<PostActionResponse> {
    const pb = this.getPocketBase();
    return pb.send(`/api/posts/${postId}/like`, {
      method: 'POST',
      headers: actionRequestHeaders(),
    });
  }

  /**
   * 取消点赞文章（需登录；计数 -1 且不为负）
   */
  async unlikePost(postId: string): Promise<PostActionResponse> {
    const pb = this.getPocketBase();
    return pb.send(`/api/posts/${postId}/like`, {
      method: 'DELETE',
      headers: actionRequestHeaders(),
    });
  }

  /**
   * 收藏文章（需登录；服务端按用户 id 去重，幂等）
   */
  async bookmarkPost(postId: string): Promise<PostActionResponse> {
    const pb = this.getPocketBase();
    return pb.send(`/api/posts/${postId}/bookmark`, {
      method: 'POST',
      headers: actionRequestHeaders(),
    });
  }

  /**
   * 取消收藏文章（需登录；幂等）
   */
  async unbookmarkPost(postId: string): Promise<PostActionResponse> {
    const pb = this.getPocketBase();
    return pb.send(`/api/posts/${postId}/bookmark`, {
      method: 'DELETE',
      headers: actionRequestHeaders(),
    });
  }
}

export const postService = new PostService();
