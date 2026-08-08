import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface PostVersion {
  id: string;
  post_id: string;
  content: string;
  title: string;
  excerpt: string;
  editor: string;
  note?: string;
  created: string;
  expand?: {
    post_id?: { id: string; title: string; slug: string };
    editor?: { id: string; name: string };
  };
}

type PostVersionRecord = PostVersion & RecordModel;

export interface Post {
  id: string;
  title: string;
  slug: string;
}

class VersionHistoryService extends BaseService<PostVersionRecord> {
  constructor() {
    super('post_versions');
  }

  async getVersions(postId?: string, page: number = 1, perPage: number = 20) {
    const filter = postId ? `post_id = "${postId}"` : undefined;
    return this.getList(page, perPage, {
      sort: '-created',
      expand: 'post_id,editor',
      filter,
    });
  }

  async getVersionById(id: string) {
    return this.getOne(id, { expand: 'post_id,editor' });
  }

  async getPosts(): Promise<Post[]> {
    const pb = this.getPocketBase();
    const result = await pb.collection('posts').getList(1, 200, {
      sort: '-updated',
      fields: 'id,title,slug',
    });
    return result.items as unknown as Post[];
  }

  async compareVersions(leftId: string, rightId: string) {
    const [left, right] = await Promise.all([
      this.getVersionById(leftId),
      this.getVersionById(rightId),
    ]);
    return { left, right };
  }
}

export const versionHistoryService = new VersionHistoryService();