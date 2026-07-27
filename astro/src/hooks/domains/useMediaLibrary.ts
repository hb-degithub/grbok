import { useState, useEffect, useCallback, useRef } from 'react';
import { mediaService, type MediaAsset, type UploadProgress } from '../../lib/services/mediaService';
import { showToast } from '../../components/ui/Toast';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

export function useMediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await mediaService.getAssets(1, 60);
      setAssets(result.items);
    } catch (err) {
      console.error('获取媒体文件失败：', err);
      showToast('获取媒体文件失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(null);
    try {
      await mediaService.uploadAsset(file, (progress) => {
        setUploadProgress(progress);
      });
      showToast('上传成功', 'success');
      fetchAssets();
    } catch (err) {
      console.error('上传失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '上传失败'), 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [fetchAssets]);

  const deleteAsset = useCallback(async (id: string) => {
    try {
      await mediaService.deleteAsset(id);
      showToast('删除成功', 'success');
      fetchAssets();
    } catch (err) {
      console.error('删除失败：', err);
      if (notifyStepUpExpired(err)) {
        showToast('管理会话已过期，请重新验证动态口令', 'error');
        return;
      }
      showToast(describePbError(err, '删除失败'), 'error');
    }
  }, [fetchAssets]);

  const getFileUrl = useCallback((asset: MediaAsset, thumb?: string) => {
    return mediaService.getFileUrl(asset, thumb);
  }, []);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    e.target.value = '';
  }, [uploadFile]);

  return {
    assets,
    loading,
    uploading,
    uploadProgress,
    fileInputRef,
    fetchAssets,
    uploadFile,
    deleteAsset,
    getFileUrl,
    triggerFileInput,
    handleFileChange,
  };
}