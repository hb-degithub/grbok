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

  /** 管理端：获取全部公告（含未启用） */
  async getAll(limit = 100): Promise<Announcement[]> {
    const result = await this.getList(1, limit, { sort: '-created' });
    return result.items;
  }

  /** 管理端：新建或更新公告 */
  async save(data: Partial<Announcement> & { id?: string }): Promise<Announcement> {
    if (data.id) {
      const record = await this.update(data.id, data);
      return record as unknown as Announcement;
    }
    const record = await this.create(data as unknown as Partial<AnnouncementRecord>);
    return record as unknown as Announcement;
  }

  /** 管理端：删除公告 */
  async remove(id: string): Promise<void> {
    await this.delete(id);
  }

  /** 管理端：切换启用状态 */
  async toggleEnabled(id: string, enabled: boolean): Promise<Announcement> {
    const record = await this.update(id, { enabled });
    return record as unknown as Announcement;
  }
}

export const announcementService = new AnnouncementService();
