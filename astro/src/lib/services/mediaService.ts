import { BaseService } from './baseService';
import type { RecordModel } from 'pocketbase';

export interface MediaAsset {
  id: string;
  file: string;  // PocketBase 文件字段名
  alt: string;    // 文件名/描述
  mime_type?: string;
  size: number;
  url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  uploader?: string;
  created: string;
  updated: string;
  expand?: {
    uploader?: {
      id: string;
      name: string;
      email: string;
    };
  };
}

type MediaAssetRecord = MediaAsset & RecordModel;

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

class MediaService extends BaseService<MediaAssetRecord> {
  constructor() {
    super('media_assets');
  }

  async getAssets(page: number = 1, perPage: number = 60) {
    return this.getList(page, perPage, {
      sort: '-created',
      expand: 'uploader',
    });
  }

  async uploadAsset(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<MediaAsset> {
    const pb = this.getPocketBase();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('alt', file.name); // 使用已有字段 alt 存储文件名
    formData.append('uploader', pb.authStore.record?.id || ''); // 必填字段
    formData.append('size', String(file.size));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percent: Math.round((e.loaded / e.total) * 100),
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            reject(new Error('Invalid response'));
          }
        } else {
          // 解析 PocketBase 错误详情
          let errorBody: unknown;
          try { errorBody = JSON.parse(xhr.responseText); } catch { /* ignore */ }
          const err = new Error(`Upload failed: ${xhr.status}`);
          (err as any).status = xhr.status;
          (err as any).response = { data: errorBody };
          reject(err);
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      const url = pb.buildUrl('/api/collections/media_assets/records');
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', pb.authStore.token ? `Bearer ${pb.authStore.token}` : '');
      xhr.send(formData);
    });
  }

  async deleteAsset(id: string): Promise<boolean> {
    return this.delete(id);
  }

  getFileUrl(record: MediaAsset, thumb?: string): string {
    const pb = this.getPocketBase();
    return pb.files.getUrl(record as unknown as RecordModel, record.file, thumb ? { thumb } : undefined);
  }
}

export const mediaService = new MediaService();