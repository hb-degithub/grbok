import React, { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useMediaLibrary } from '../../hooks/domains/useMediaLibrary';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { showToast } from '../ui/Toast';
import ConfirmDialog from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import type { MediaAsset } from '../../lib/services/mediaService';

interface MediaLibraryProps {
  onSelect?: (url: string) => void;
  onClose?: () => void;
}

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants: Variants = {
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
  const {
    assets,
    loading,
    uploading,
    uploadProgress,
    fileInputRef,
    deleteAsset,
    getFileUrl,
    triggerFileInput,
    handleFileChange,
  } = useMediaLibrary();
  
  const { user, role } = useAdminAuth();
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
  const isPicker = typeof onSelect === 'function';

  const handleDelete = (id: string) => {
    setConfirmState({ open: true, id });
  };

  const confirmDelete = async () => {
    await deleteAsset(confirmState.id);
    setConfirmState({ open: false, id: '' });
  };

  const handleSelect = (asset: MediaAsset) => {
    if (isPicker && onSelect) {
      onSelect(getFileUrl(asset));
      onClose?.();
    }
  };

  const canDelete = (asset: MediaAsset) => {
    if (role === 'super_admin') return true;
    if (role === 'admin' && asset.uploader === user?.id) return true;
    return false;
  };

  return (
    <div className="space-y-4">
      {/* 上传区域 */}
      <div className="card rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text">媒体库</h3>
            <p className="text-xs text-text-secondary">共 {assets.length} 个文件</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={triggerFileInput}
              disabled={uploading}
              className="btn-primary min-h-10 px-4 text-xs disabled:opacity-50"
            >
              {uploading ? `上传中 ${uploadProgress?.percent || 0}%` : '上传图片'}
            </button>
          </div>
        </div>
        {uploadProgress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-soft">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 媒体网格 */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-bg-soft" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="card rounded-md p-8 text-center text-text-secondary">
          暂无媒体文件
        </div>
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          {assets.map((asset) => (
            <motion.div
              key={asset.id}
              variants={itemVariants}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-md border border-border bg-bg-soft',
                isPicker && 'cursor-pointer hover:border-accent'
              )}
              onClick={() => handleSelect(asset)}
            >
              <img
                src={getFileUrl(asset, '200x200')}
                alt={asset.alt || '媒体文件'}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex justify-end">
                  {canDelete(asset) && !isPicker && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(asset.id);
                      }}
                      className="rounded-full bg-danger/80 p-1.5 text-white hover:bg-danger"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="text-white">
                  <p className="truncate text-xs font-medium">{asset.alt || '未命名'}</p>
                  <p className="text-[10px] opacity-80">{formatSize(asset.size)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="确认删除"
        message="确定要删除这个文件吗？此操作不可撤销。"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirmState({ open: false, id: '' })}
      />
    </div>
  );
}