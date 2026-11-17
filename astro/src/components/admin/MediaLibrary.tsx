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

/* ===========================
   媒体库（后台）
   - 只用 --sf-* 令牌：surface/canvas + 细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标/操作按钮 2px），无阴影、无玻璃拟态、无渐变；
   - 网格：图片容器细线方角，hover 只改描边（可选时强调色），不放大、不发光。
   上传、选择、删除确认与权限判断逻辑与改造前完全一致。
   =========================== */

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:bg-[var(--sf-accent-ink)] hover:border-[var(--sf-accent-ink)]';
const BTN_SM = 'min-h-10 px-3 text-[12px]';

const listVariants = {
  hidden: { opacity: 1 },
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
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
    <div className="min-w-0 space-y-3">
      {/* 上传区域 */}
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-bold tracking-tight text-[var(--sf-ink)]">媒体库</h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">共 {assets.length} 个文件</p>
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
              className={cn(BTN_BASE, BTN_PRIMARY, BTN_SM)}
            >
              {uploading ? `上传中 ${uploadProgress?.percent || 0}%` : '上传图片'}
            </button>
          </div>
        </div>
        {uploadProgress && (
          <div className="mt-3">
            <div className="h-[2px] overflow-hidden bg-[var(--sf-line-soft)]">
              <div
                className="h-full bg-[var(--sf-accent)] transition-all"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 媒体网格 */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-[3px] border border-[var(--sf-line-soft)] bg-[var(--sf-canvas)]" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">暂无媒体文件</p>
        </div>
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          {assets.map((asset) => (
            <motion.div
              key={asset.id}
              variants={itemVariants}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] transition-colors duration-200 hover:border-[var(--sf-line-strong)]',
                isPicker && 'cursor-pointer hover:border-[var(--sf-accent)]'
              )}
              onClick={() => handleSelect(asset)}
            >
              <img
                src={getFileUrl(asset, '200x200')}
                alt={asset.alt || '媒体文件'}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex flex-col justify-between p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                <div className="flex justify-end">
                  {canDelete(asset) && !isPicker && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(asset.id);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)] transition-colors hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-accent)]"
                      title="删除文件"
                      aria-label="删除文件"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="min-w-0 self-stretch border-t border-[var(--sf-line)] bg-[var(--sf-surface)] px-1.5 py-1">
                  <p className="truncate text-[11px] font-medium text-[var(--sf-ink)]">{asset.alt || '未命名'}</p>
                  <p className="truncate font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">{formatSize(asset.size)}</p>
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
