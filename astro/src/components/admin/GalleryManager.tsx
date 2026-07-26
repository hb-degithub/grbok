import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

interface GalleryItem {
  id: string;
  title: string;
  description: string;
  album: string;
  sort_order: number;
  status: string;
  photo: string;
  created: string;
}

const STATUS_TONE: Record<string, string> = {
  show: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  hidden: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
};

export default function GalleryManager() {
  const { user } = useAdminAuth();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newAlbum, setNewAlbum] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';
  const isAuthor = user?.role === 'author' || user?.role === 'admin' || isSuperAdmin;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const pb = getPocketBase();
      const result = await pb.collection('gallery_items').getList<GalleryItem>(1, 50, {
        sort: '-created',
        filter: filter ? `status = "${filter}"` : undefined,
      });
      setItems(result.items || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || '无法读取相册');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = useCallback(async (item: GalleryItem) => {
    const next = item.status === 'show' ? 'hidden' : 'show';
    setError('');
    setStatus('');
    try {
      const pb = getPocketBase();
      await pb.collection('gallery_items').update(item.id, { status: next });
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, status: next } : it));
      setStatus(`相片已${next === 'show' ? '显示' : '隐藏'}`);
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, '操作失败'));
    }
  }, []);

  const remove = useCallback(async (item: GalleryItem) => {
    if (!window.confirm(`确定删除${item.title ? `「${item.title}」` : '该相片'}？此操作不可逆。`)) return;
    setError('');
    setStatus('');
    try {
      const pb = getPocketBase();
      await pb.collection('gallery_items').delete(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setStatus('相片已删除');
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, '删除失败'));
    }
  }, []);

  const handleUpload = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('请选择图片文件');
      return;
    }
    setError('');
    setStatus('');
    setUploading(true);
    try {
      const pb = getPocketBase();
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('status', 'show');
      if (newTitle.trim()) formData.append('title', newTitle.trim());
      if (newAlbum.trim()) formData.append('album', newAlbum.trim());
      formData.append('sort_order', '0');
      await pb.collection('gallery_items').create(formData);
      setFile(null);
      setNewTitle('');
      setNewAlbum('');
      setStatus('上传成功');
      load();
    } catch (err: unknown) {
      if (notifyStepUpExpired(err)) { setError('管理会话已过期，请重新验证动态口令'); return; }
      setError(describePbError(err, '上传失败：请确认文件类型为 JPEG/PNG/WebP/GIF 且不超过 10MB'));
    } finally {
      setUploading(false);
    }
  }, [file, newTitle, newAlbum, load]);

  const fmtDate = (s: string) => {
    if (!s) return '-';
    try { return new Date(s.replace(' ', 'T')).toLocaleString('zh-CN'); } catch { return s; }
  };

  const photoUrl = (item: GalleryItem, thumb: string) => {
    const pb = getPocketBase();
    const fileName = Array.isArray(item.photo) ? item.photo[0] : item.photo;
    if (!fileName) return '';
    const base = pb.baseUrl.replace(/\/$/, '');
    const path = `api/files/gallery_items/${item.id}/${fileName}`;
    return thumb ? `${base}/${path}?thumb=${thumb}` : `${base}/${path}`;
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