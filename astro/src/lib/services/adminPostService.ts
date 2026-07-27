import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content?: string;
  cover?: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  published_at?: string;
  views?: number;
  is_pinned?: boolean;
  is_featured?: boolean;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  created: string;
  updated: string;
}

type PostRecord = Post & RecordModel;

export interface PostFilter {
  status?: string;
  query?: string;
}

class AdminPostService extends BaseService<PostRecord> {
  constructor() {
    super('posts');
  }

  async getPosts(page: number = 1, perPage: number = 20, filter?: PostFilter) {
    const pb = this.getPocketBase();
    const parts: string[] = [];

    if (filter?.status && filter.status !== 'all') {
      parts.push(pb.filter('status = {:status}', { status: filter.status }));
    }

    if (filter?.query) {
      const safeKeyword = filter.query.replace(/["\\]/g, '');
      parts.push(pb.filter('(title ~ {:kw} || slug ~ {:kw} || excerpt ~ {:kw})', { kw: safeKeyword }));
    }

    const filterString = parts.length > 0 ? parts.join(' && ') : undefined;

    return this.getList(page, perPage, {
      filter: filterString,
      sort: '-updated',
    });
  }

  async getPostById(id: string) {
    return this.getOne(id);
  }

  async createPost(data: Partial<Post>) {
    const pb = this.getPocketBase();
    return this.create({
      ...data,
      author: pb.authStore.record?.id,
    });
  }

  async updatePost(id: string, data: Partial<Post>) {
    return this.update(id, data);
  }

  async deletePost(id: string) {
    return this.delete(id);
  }

  async updatePostStatus(id: string, status: Post['status']) {
    const data: Record<string, unknown> = { status };
    if (status === 'published') {
      data.published_at = new Date().toISOString();
    }
    return this.update(id, data);
  }

  async getTags() {
    const pb = this.getPocketBase();
    return pb.collection('tags').getList(1, 100);
  }

  async getPostTags(postId: string) {
    const pb = this.getPocketBase();
    return pb.collection('post_tags').getList(1, 100, {
      filter: pb.filter('post_id = {:postId}', { postId }),
    });
  }

  async syncPostTags(postId: string, tagIds: string[]) {
    const pb = this.getPocketBase();
    const existing = await this.getPostTags(postId);
    const existingIds = existing.items.map(i => i.tag_id);
    const toRemove = existing.items.filter(i => !tagIds.includes(i.tag_id));
    const toAdd = tagIds.filter(id => !existingIds.includes(id)).filter(Boolean);

    await Promise.all(toRemove.map(i => pb.collection('post_tags').delete(i.id)));
    await Promise.all(toAdd.map(id => pb.collection('post_tags').create({ post_id: postId, tag_id: id })));
  }
}

export const adminPostService = new AdminPostService();