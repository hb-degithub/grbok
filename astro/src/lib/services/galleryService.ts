import { BaseService } from './baseService';
import { buildFileUrl } from '../pocketbase';
import { pbBaseUrl } from '../pb-base-url';
import { getAdminClientSession, readAdminStepUp } from '../admin-step-up';
import { getBrowserFingerprint } from '../security';
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
 * 缩略图尺寸（与 pb_migrations/20260912000000_add_image_thumbs_whitelist.pb.js 白名单一致）：
 * `gallery_items.photo` 允许 300x300 / 320x0 / 640x0 / 1024x0 / 1600x0。
 *
 * 约定：列表永远用 300x300，灯箱用 1600x0 —— **任何场景都不再请求原图**，
 * 否则单张 9MB 的照片会把首屏流量打爆。
 */
export const GALLERY_LIST_THUMB = '300x300';
export const GALLERY_LIGHTBOX_THUMB = '1024x0';

export interface GalleryUploadProgress {
  /** 0-100 的整数百分比 */
  percent: number;
  loaded: number;
  total: number;
}

export interface GalleryUploadOptions {
  title?: string;
  album?: string;
  status?: 'show' | 'hidden';
  /** XHR 上传进度回调（浏览器在 `xhr.upload.onprogress` 里给出真实字节数） */
  onProgress?: (progress: GalleryUploadProgress) => void;
  /** 外部取消（组件卸载/用户取消） */
  signal?: AbortSignal;
}

/** 上传请求携带的管理头：与 pocketbase.ts 的 beforeSend 拦截器保持一致 */
async function buildUploadHeaders(token: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = token;

  // 服务端 pb_hooks/lib/admin_step_up.js 对 admin/super_admin 的受保护集合写操作
  // 强制校验 step-up 凭证 + 客户端会话 + 浏览器指纹。XHR 绕开了 PB SDK 的
  // beforeSend，因此这里必须手动补齐同一组头，否则上传会 403 ADMIN_STEP_UP_REQUIRED。
  if (typeof window === 'undefined') return headers;
  const stepUp = readAdminStepUp();
  if (!stepUp) return headers;

  headers['X-Admin-Session'] = getAdminClientSession();
  headers['X-Browser-Fingerprint'] = await getBrowserFingerprint();
  headers['X-Auth-Client-Time'] = new Date().toISOString();
  headers['X-Requested-With'] = 'XMLHttpRequest';
  headers['X-Admin-Step-Up'] = stepUp.credential;
  return headers;
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 构造与 PocketBase SDK 形状一致的错误对象，让 describePbError / isStepUpRequired
 * 能按 status + response 正确翻译（XHR 不会自己生成 ClientResponseError）。
 *
 * SDK 的 ClientResponseError 会把**整个响应体**放进 `response`：
 * `err.response.message` 是服务端文案，`err.response.data` 是字段级错误表。
 */
function uploadError(status: number, payload: Record<string, unknown> | null): Error {
  const body = payload ?? {};
  const message =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : status === 0
        ? '网络异常，请检查连接后重试'
        : `上传失败（HTTP ${status}）`;
  const error = new Error(message) as Error & {
    status?: number;
    response?: Record<string, unknown>;
    data?: Record<string, unknown>;
  };
  error.status = status;
  error.response = body;
  error.data = body;
  return error;
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
   * 上传图片（PB SDK，无进度回调）
   *
   * 保留给非后台调用方；后台上传走 `uploadWithProgress` 以获得真实进度。
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
   * 上传图片（XMLHttpRequest 直传，带进度回调）
   *
   * PocketBase JS SDK 的 `create()` 不暴露上传进度，因此这里直接打
   * `POST /api/collections/gallery_items/records`，监听 `xhr.upload.onprogress`。
   */
  async uploadWithProgress(file: File, options: GalleryUploadOptions = {}): Promise<GalleryItem> {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('status', options.status ?? 'show');
    const title = options.title?.trim();
    const album = options.album?.trim();
    if (title) formData.append('title', title);
    if (album) formData.append('album', album);
    formData.append('sort_order', '0');

    const token = this.getPocketBase().authStore.token;
    const headers = await buildUploadHeaders(token);
    const url = `${pbBaseUrl()}/api/collections/${encodeURIComponent(this.collection)}/records`;

    return new Promise<GalleryItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'text';

      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable || event.total <= 0) return;
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        options.onProgress?.({ percent, loaded: event.loaded, total: event.total });
      };

      xhr.onload = () => {
        const payload = parseJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          // 传输层已完成：补一次 100%，避免最后一个分片事件停在 99%
          options.onProgress?.({ percent: 100, loaded: file.size, total: file.size });
          if (payload) {
            resolve(payload as unknown as GalleryItem);
            return;
          }
          reject(uploadError(xhr.status, null));
          return;
        }
        reject(uploadError(xhr.status, payload));
      };

      xhr.onerror = () => reject(uploadError(0, null));
      xhr.ontimeout = () => reject(uploadError(0, null));
      xhr.onabort = () => {
        if (options.signal?.aborted) reject(uploadError(0, { message: '上传已取消' }));
        else reject(uploadError(0, null));
      };

      if (options.signal) {
        if (options.signal.aborted) {
          reject(uploadError(0, { message: '上传已取消' }));
          return;
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.send(formData);
    });
  }

  /**
   * 获取图片 URL
   */
  getPhotoUrl(item: GalleryItem, thumb?: string): string {
    const fileName = Array.isArray(item.photo) ? item.photo[0] : item.photo;
    if (!fileName) return '';
    return buildFileUrl('gallery_items', item.id, fileName, thumb);
  }

  /** 列表缩略图 URL（300x300） */
  getListThumbUrl(item: GalleryItem): string {
    return this.getPhotoUrl(item, GALLERY_LIST_THUMB);
  }

  /** 灯箱大图 URL（1600x0，仍是缩略图而非原图） */
  getLightboxUrl(item: GalleryItem): string {
    return this.getPhotoUrl(item, GALLERY_LIGHTBOX_THUMB);
  }
}

export const galleryService = new GalleryService();
