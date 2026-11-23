import { useState, useEffect, useCallback } from 'react';
import { galleryService, type GalleryItem } from '../../lib/services/galleryService';
import { compressImageFile, formatBytes } from '../../lib/image-compress';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

interface UseGalleryOptions {
  /** 是否自动获取数据 */
  autoFetch?: boolean;
}

/** 上传阶段：压缩（浏览器端）→ 传输（XHR） */
export type GalleryUploadStage = 'idle' | 'compressing' | 'uploading';

export interface GalleryUploadState {
  stage: GalleryUploadStage;
  /** 0-100；压缩阶段固定 0（没有可量化的进度） */
  percent: number;
  /** 当前处理的文件名（压缩后可能改扩展名） */
  fileName: string;
  /** 原文件体积（压缩前） */
  originalBytes: number;
  /** 压缩后体积（进入上传阶段后才有值） */
  compressedBytes: number;
}

const IDLE_UPLOAD: GalleryUploadState = {
  stage: 'idle',
  percent: 0,
  fileName: '',
  originalBytes: 0,
  compressedBytes: 0,
};

interface UseGalleryReturn {
  items: GalleryItem[];
  loading: boolean;
  error: string;
  status: string;
  filter: string;
  uploading: boolean;
  uploadState: GalleryUploadState;
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
 *
 * 上传链路（2026-11 改造）：
 * 1. 浏览器端 canvas 压缩（长边 ≤2560、JPEG 0.85），9MB 原图通常降到数百 KB；
 * 2. XMLHttpRequest 直传 PB records 接口，用 `xhr.upload.onprogress` 驱动进度条。
 * 压缩失败会自动回退原文件，不会因此挡住上传。
 */
export function useGallery(options: UseGalleryOptions = {}): UseGalleryReturn {
  const { autoFetch = true } = options;

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState<GalleryUploadState>(IDLE_UPLOAD);

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
    setUploadState({ ...IDLE_UPLOAD, stage: 'compressing', fileName: file.name, originalBytes: file.size });
    try {
      // 1) 压缩：失败时 compressImageFile 内部已回退原文件，这里永远拿到可上传的 File
      const prepared = await compressImageFile(file);
      setUploadState({
        stage: 'uploading',
        percent: 0,
        fileName: prepared.name,
        originalBytes: file.size,
        compressedBytes: prepared.size,
      });

      // 2) XHR 直传：进度来自 xhr.upload.onprogress
      await galleryService.uploadWithProgress(prepared, {
        title,
        album,
        onProgress: ({ percent }) => {
          setUploadState((prev) => (prev.stage === 'uploading' ? { ...prev, percent } : prev));
        },
      });

      const saved = file.size - prepared.size;
      setStatus(
        saved > 0
          ? `上传成功（已压缩 ${formatBytes(file.size)} → ${formatBytes(prepared.size)}）`
          : '上传成功',
      );
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
      setUploadState(IDLE_UPLOAD);
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
    uploadState,
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
