import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { Announcement } from '../../types/pocketbase';

interface AnnouncementRecord extends RecordModel, Announcement {}

class AnnouncementService extends BaseService<AnnouncementRecord> {
  constructor() {
    super('announcements');
  }

  /**
   * 获取最新公告
   */
  async getLatest(limit: number = 3): Promise<Announcement[]> {
    const result = await this.getList(1, limit, { sort: '-created' });
    return result.items;
  }
}

export const announcementService = new AnnouncementService();
