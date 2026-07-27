import { useState, useEffect, useCallback } from 'react';
import { galleryService, type GalleryItem } from '../../lib/services/galleryService';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

interface UseGalleryOptions {
  /** 是否自动获取数据 */
  autoFetch?: boolean;
}

interface UseGalleryReturn {
  items: GalleryItem[];
  loading: boolean;
  error: string;
  status: string;
  filter: string;
  uploading: boolean;
  setFilter: (filter: string) => void;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
  load: () => Promise<void>;
  toggleStatus: (item: GalleryItem) => Promise<boolean>;
  remove: (item: GalleryItem) => Promise<boolean>;
  upload: (file: File, title?: string, album?: string) => Promise<boolean>;
  getPhotoUrl: (item: GalleryItem, thumb?: string) => string;
}

/**
 * 图库数据管理 Hook
 * 封装图库的获取、上传、删除、状态切换等操作
 */
export function useGallery(options: UseGalleryOptions = {}): UseGalleryReturn {
  const { autoFetch = true } = options;

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await galleryService.getItems(filter);
      setItems(data);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取相册');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (autoFetch) {
      load();
    }
  }, [autoFetch, load]);

  const toggleStatus = useCallback(async (item: GalleryItem): Promise<boolean> => {
    setError('');
    setStatus('');
    try {
      const updated = await galleryService.toggleStatus(item);
      setItems((prev) => prev.map((it) => it.id === item.id ? updated : it));
      setStatus(`相片已${updated.status === 'show' ? '显示' : '隐藏'}`);
      return true;
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(describePbError(err, '操作失败'));
      return false;
    }
  }, []);

  const remove = useCallback(async (item: GalleryItem): Promise<boolean> => {
    setError('');
    setStatus('');
    try {
      await galleryService.delete(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setStatus('相片已删除');
      return true;
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(describePbError(err, '删除失败'));
      return false;
    }
  }, []);

  const upload = useCallback(async (file: File, title?: string, album?: string): Promise<boolean> => {
    setError('');
    setStatus('');
    setUploading(true);
    try {
      await galleryService.upload(file, title, album);
      setStatus('上传成功');
      await load();
      return true;
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) {
        setError('管理会话已过期，请重新验证动态口令');
        return false;
      }
      setError(describePbError(err, '上传失败：请确认文件类型为 JPEG/PNG/WebP/GIF 且不超过 10MB'));
      return false;
    } finally {
      setUploading(false);
    }
  }, [load]);

  const getPhotoUrl = useCallback((item: GalleryItem, thumb?: string): string => {
    return galleryService.getPhotoUrl(item, thumb);
  }, []);

  return {
    items,
    loading,
    error,
    status,
    filter,
    uploading,
    setFilter,
    setError,
    setStatus,
    load,
    toggleStatus,
    remove,
    upload,
    getPhotoUrl,
  };
}
