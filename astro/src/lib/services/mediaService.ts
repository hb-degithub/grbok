import { BaseService } from './baseService';
import { buildFileUrl } from '../pocketbase';
import { compressImageFile } from '../image-compress';
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

  /**
   * 上传一个媒体文件。
   *
   * 上传前自动压缩（默认开启）：图片会按 `image-compress` 的策略压到长边 2560 / JPEG 0.85，
   * 小图与不支持的类型原样上传；压缩失败内部已回退原文件，所以这里不会抛错。
   * 传入 `{ compress: false }` 可保留原图（例如需要无损素材时）。
   */
  async uploadAsset(
    file: File,
    onProgress?: (progress: UploadProgress) => void,
    options: { compress?: boolean } = {}
  ): Promise<MediaAsset> {
    const prepared = options.compress === false ? file : await compressImageFile(file);
    const pb = this.getPocketBase();
    // 压缩后文件名/扩展名会变（png→webp、同名→.jpg），表单字段统一使用压缩结果
    const uploadName = prepared === file ? file.name : prepared.name;
    const formData = new FormData();
    formData.append('file', prepared, uploadName);
    formData.append('alt', uploadName); // 使用已有字段 alt 存储文件名
    formData.append('uploader', pb.authStore.record?.id || ''); // 必填字段
    formData.append('size', String(prepared.size));

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
    return buildFileUrl('media_assets', record.id, record.file, thumb);
  }
}

export const mediaService = new MediaService();