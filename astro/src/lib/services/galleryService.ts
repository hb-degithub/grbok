import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

/**
 * 图库项接口
 */
export interface GalleryItem extends RecordModel {
  title: string;
  description: string;
  album: string;
  sort_order: number;
  status: string;
  photo: string;
}

/**
 * 图库服务
 * 封装图库相关的所有数据操作
 */
class GalleryService extends BaseService<GalleryItem> {
  constructor() {
    super('gallery_items');
  }

  /**
   * 获取图库列表
   * @param statusFilter 状态筛选：''（全部）、'show'（显示中）、'hidden'（已隐藏）
   */
  async getItems(statusFilter: string = ''): Promise<GalleryItem[]> {
    const result = await this.getList(1, 50, {
      sort: '-created',
      filter: statusFilter ? `status = "${statusFilter}"` : undefined,
    });
    return result.items;
  }

  /**
   * 切换显示状态
   */
  async toggleStatus(item: GalleryItem): Promise<GalleryItem> {
    const next = item.status === 'show' ? 'hidden' : 'show';
    return this.update(item.id, { status: next });
  }

  /**
   * 上传图片
   */
  async upload(file: File, title?: string, album?: string): Promise<GalleryItem> {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('status', 'show');
    if (title?.trim()) formData.append('title', title.trim());
    if (album?.trim()) formData.append('album', album.trim());
    formData.append('sort_order', '0');

    const pb = this.getPocketBase();
    return pb.collection(this.collection).create<GalleryItem>(formData);
  }

  /**
   * 获取图片 URL
   */
  getPhotoUrl(item: GalleryItem, thumb?: string): string {
    const pb = this.getPocketBase();
    const fileName = Array.isArray(item.photo) ? item.photo[0] : item.photo;
    if (!fileName) return '';
    const base = pb.baseUrl.replace(/\/$/, '');
    const path = `api/files/gallery_items/${item.id}/${fileName}`;
    return thumb ? `${base}/${path}?thumb=${thumb}` : `${base}/${path}`;
  }
}

export const galleryService = new GalleryService();
