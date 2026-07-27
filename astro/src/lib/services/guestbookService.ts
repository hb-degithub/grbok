import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

/**
 * 留言项接口
 */
export interface GuestbookItem extends RecordModel {
  nickname: string;
  content: string;
  status: string;
}

/**
 * 留言板服务
 * 封装留言板相关的所有数据操作
 */
class GuestbookService extends BaseService<GuestbookItem> {
  constructor() {
    super('guestbook_messages');
  }

  /**
   * 获取留言列表
   * @param statusFilter 状态筛选：''（全部）、'show'（显示中）、'hidden'（已隐藏）
   */
  async getItems(statusFilter: string = ''): Promise<GuestbookItem[]> {
    const result = await this.getList(1, 50, {
      sort: '-created',
      filter: statusFilter ? `status = "${statusFilter}"` : undefined,
    });
    return result.items;
  }

  /**
   * 切换显示状态
   */
  async toggleStatus(item: GuestbookItem): Promise<GuestbookItem> {
    const next = item.status === 'show' ? 'hidden' : 'show';
    return this.update(item.id, { status: next });
  }
}

export const guestbookService = new GuestbookService();
