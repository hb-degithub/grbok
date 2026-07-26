import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';
import type { MediaAsset } from '../../types/pocketbase';

interface MediaLibraryProps {
  /** 选择模式：传入回调后，点击图片触发 onSelect 并关闭自身（用于封面选择器） */
  onSelect?: (url: string) => void;
  /** 选择模式下用于关闭外层容器（如果有） */
  onClose?: () => void;
}

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function MediaLibrary({ onSelect, onClose }: MediaLibraryProps) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const { user, role } = useAdminAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPicker = typeof onSelect === 'function';

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    const pb = getPocketBase();
    try {
      const result = await pb.collection('media_assets').getList<MediaAsset>(1, 60, {
        sort: '-created',
        expand: 'uploader',
      });
      setAssets(result.items);
    } catch (err) {
      console.error('获取媒体列表失败:', err);
      showToast('媒体列表加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const pb = getPocketBase();
    setUploading(true);
    let success = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('uploader', pb.authStore.record?.id || '');
        formData.append('alt', '');
        formData.append('size', String(file.size));
        await pb.collection('media_assets').create(formData);
        success++;
      } catch (err) {
        console.error('上传失败:', err);
        if (notifyStepUpExpired(err)) { showToast('管理会话已过期，请重新验证动态口令', 'error'); setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; fetchAssets(); return; }
        failed++;
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (success > 0) showToast(`上传成功 ${success} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`, 'success');
    else if (failed > 0) showToast(`上传失败 ${failed} 个`, 'error');
    fetchAssets();
  };

  const copyUrl = async (asset: MediaAsset) => {
    const pb = getPocketBase();
    try {
      const url = pb.files.getUrl(asset, asset.file);
      const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
      await navigator.clipboard.writeText(absolute);
      showToast('已复制图片 URL', 'success');
    } catch (err) {
      console.error('复制失败:', err);
      showToast('复制失败', 'error');
    }
  };

  const pickAsset = (asset: MediaAsset) => {
    if (!onSelect) return;
    const pb = getPocketBase();
    const url = pb.files.getUrl(asset, asset.file);
    const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    onSelect(absolute);
    onClose?.();
  };

  const deleteAsset = async (id: string) => {
    const pb = getPocketBase();
    try {
      await pb.collection('media_assets').delete(id);
      showToast('已删除', 'success');
      fetchAssets();
    } catch (err) {
      console.error('删除失败:', err);
      if (notifyStepUpExpired(err)) { showToast('管理会话已过期，请重新验证动态口令', 'error'); return; }
      showToast(describePbError(err, '删除失败'), 'error');
    }
  };

  const canDelete = (asset: MediaAsset) => {
    if (role === 'super_admin') return true;
    if (role === 'admin') return true;
    // author 仅可删自己的
    return asset.uploader === user?.id;
  };

  return (
    <div className="space-y-4">
      {!isPicker && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">共 {assets.length} 个媒体文件</p>
          <label className={cn('btn-primary min-h-10 cursor-pointer rounded-md px-3 text-xs', uploading && 'pointer-events-none opacity-60')}>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
            {uploading ? '上传中...' : '+ 上传图片'}
          </label>
        </div>
      )}
      {isPicker && uploading && (
        <div className="text-center text-xs text-text-secondary">上传中...</div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md border border-border bg-bg-soft" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="card rounded-md p-12 text-center text-sm text-text-secondary">
          暂无媒体文件。{isPicker ? '请先在媒体库上传。' : '点击右上角上传第一张图片。'}
        </div>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => {
            const pb = getPocketBase();
            const url = pb.files.getUrl(asset, asset.file);
            return (
              <motion.div key={asset.id} variants={itemVariants} className="card group relative overflow-hidden rounded-md border border-border bg-white">
                <div className="aspect-square overflow-hidden bg-bg-soft">
                  <img
                    src={url}
                    alt={asset.alt || ''}
                    loading="lazy"
                    className="h-full w-full cursor-pointer object-cover transition-transform duration-300 group-hover:scale-105"
                    onClick={() => (isPicker ? pickAsset(asset) : copyUrl(asset))}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="truncate font-mono text-[10px] text-muted">{formatSize(asset.size)}</span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button onClick={() => copyUrl(asset)} title="复制 URL" aria-label="复制 URL" className="inline-flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-accent/10 hover:text-accent">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    {isPicker && (
                      <button onClick={() => pickAsset(asset)} title="选择此图片" aria-label="选择" className="inline-flex h-7 w-7 items-center justify-center rounded text-accent hover:bg-accent/10">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </button>
                    )}
                    {canDelete(asset) && (
                      <button onClick={() => setConfirmState({ open: true, id: asset.id })} title="删除" aria-label="删除" className="inline-flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-danger/10 hover:text-danger">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
      {isPicker && (
        <label className={cn('btn-primary inline-flex min-h-10 cursor-pointer items-center rounded-md px-3 text-xs', uploading && 'pointer-events-none opacity-60')}>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
          {uploading ? '上传中...' : '+ 上传新图片'}
        </label>
      )}
      <ConfirmDialog
        open={confirmState.open}
        title="确认删除"
        message="确定删除这个媒体文件吗？已使用的文章封面会变成失效链接。"
        danger
        onConfirm={() => { deleteAsset(confirmState.id); setConfirmState({ open: false, id: '' }); }}
        onCancel={() => setConfirmState({ open: false, id: '' })}
      />
    </div>
  );
}
