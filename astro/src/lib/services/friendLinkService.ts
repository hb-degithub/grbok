import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';
import type { FriendLink } from '../../types/pocketbase';

// FriendLink 已经包含 id 字段，与 RecordModel 兼容
type FriendLinkRecord = FriendLink & RecordModel;

/**
 * 友链服务
 * 封装友链相关的所有数据操作
 */
class FriendLinkService extends BaseService<FriendLinkRecord> {
  constructor() {
    super('friend_links');
  }

  /**
   * 获取所有友链（按排序字段排序）
   */
  async getAllSorted(): Promise<FriendLink[]> {
    const result = await this.getList(1, 200, { sort: 'sort_order' });
    return result.items;
  }

  /**
   * 获取显示的友链（前台展示用）
   */
  async getVisible(): Promise<FriendLink[]> {
    const result = await this.getList(1, 200, {
      filter: 'status = "show"',
      sort: 'sort_order',
    });
    return result.items;
  }

  /**
   * 切换友链显示状态
   */
  async toggleStatus(link: FriendLink): Promise<FriendLink> {
    const next = link.status === 'show' ? 'hide' : 'show';
    return this.update(link.id, { status: next });
  }

  /**
   * 保存友链（创建或更新）
   */
  async save(data: Partial<FriendLink>): Promise<FriendLink> {
    const payload = {
      name: data.name?.trim(),
      url: data.url?.trim(),
      description: (data.description || '').trim(),
      avatar: (data.avatar || '').trim(),
      status: data.status || 'show',
      sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
    };

    if (data.id) {
      return this.update(data.id, payload);
    }
    return this.create(payload);
  }

  /**
   * 验证友链数据
   */
  validate(data: Partial<FriendLink>): string | null {
    if (!data.name?.trim()) return '名称不能为空';
    if (!data.url?.trim()) return 'URL 不能为空';
    try {
      new URL(data.url);
    } catch {
      return 'URL 格式不正确';
    }
    if (data.avatar) {
      try {
        new URL(data.avatar);
      } catch {
        return '头像 URL 格式不正确';
      }
    }
    return null;
  }
}

export const friendLinkService = new FriendLinkService();
