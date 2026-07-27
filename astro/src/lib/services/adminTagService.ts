import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string;
  created: string;
  updated: string;
}

type TagRecord = Tag & RecordModel;

class AdminTagService extends BaseService<TagRecord> {
  constructor() {
    super('tags');
  }

  async getTags(page: number = 1, perPage: number = 100) {
    return this.getList(page, perPage, {
      sort: 'name',
    });
  }

  async getTagById(id: string) {
    return this.getOne(id);
  }

  async createTag(data: Partial<Tag>) {
    return this.create(data);
  }

  async updateTag(id: string, data: Partial<Tag>) {
    return this.update(id, data);
  }

  async deleteTag(id: string) {
    return this.delete(id);
  }
}

export const adminTagService = new AdminTagService();