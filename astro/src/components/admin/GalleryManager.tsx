import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useGallery } from '../../hooks/domains/useGallery';
import type { GalleryItem } from '../../lib/services/galleryService';

const STATUS_TONE: Record<string, string> = {
  show: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  hidden: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
};

export default function GalleryManager() {
  const { user } = useAdminAuth();
  const {
    items,
    loading,
    error,
    status,
    filter,
    uploading,
    setFilter,
    setError,
    load,
    toggleStatus: toggleStatusService,
    remove: removeService,
    upload: uploadService,
    getPhotoUrl,
  } = useGallery();

  const [file, setFile] = useState<File | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newAlbum, setNewAlbum] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';
  const isAuthor = user?.role === 'author' || user?.role === 'admin' || isSuperAdmin;

  const toggleStatus = async (item: GalleryItem) => {
    await toggleStatusService(item);
  };

  const remove = async (item: GalleryItem) => {
    if (!window.confirm(`确定删除${item.title ? `「${item.title}」` : '该相片'}？此操作不可逆。`)) return;
    await removeService(item);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('请选择图片文件');
      return;
    }
    const success = await uploadService(file, newTitle, newAlbum);
    if (success) {
      setFile(null);
      setNewTitle('');
      setNewAlbum('');
    }
  };

  const fmtDate = (s: string) => {
    if (!s) return '-';
    try { return new Date(s.replace(' ', 'T')).toLocaleString('zh-CN'); } catch { return s; }
  };

  const photoUrl = (item: GalleryItem, thumb: string) => {
    return getPhotoUrl(item, thumb);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">相册管理</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">管理相册图片的显示与删除</p>
      </div>

      {isAuthor && (
        <form onSubmit={handleUpload} className="card rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">上传新相片</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm text-zinc-700 dark:text-zinc-300"
              required
            />
            <input
              type="text"
              placeholder="标题（可选）"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={100}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <input
              type="text"
              placeholder="相册（可选）"
              value={newAlbum}
              onChange={(e) => setNewAlbum(e.target.value)}
              maxLength={50}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? '上传中…' : '上传'}
          </button>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">仅允许 JPEG/PNG/WebP/GIF，单文件最大 10MB。</p>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {['', 'show', 'hidden'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            {s === 'show' ? '显示中' : s === 'hidden' ? '已隐藏' : '全部'}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      {status && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{status}</div>}
      {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无相片</p>
      )}

      {!loading && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="card overflow-hidden rounded-xl">
              <div className="aspect-video overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                {photoUrl(item, '300x300') && (
                  <img src={photoUrl(item, '300x300')} alt={item.title || ''} className="h-full w-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title || '未命名'}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[item.status] || STATUS_TONE.hidden}`}>{item.status === 'show' ? '显示' : '隐藏'}</span>
                </div>
                {item.album && <p className="text-xs text-zinc-500 dark:text-zinc-400">相册：{item.album}</p>}
                {item.description && <p className="mt-1 break-words text-xs text-zinc-600 dark:text-zinc-400">{item.description}</p>}
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{fmtDate(item.created)}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => toggleStatus(item)}
                    className="rounded-lg bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  >
                    {item.status === 'show' ? '隐藏' : '显示'}
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => remove(item)}
                      className="rounded-lg bg-red-100 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}