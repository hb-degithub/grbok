import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useGallery } from '../../hooks/domains/useGallery';
import { GALLERY_LIST_THUMB } from '../../lib/services/galleryService';
import { formatBytes } from '../../lib/image-compress';
import type { GalleryItem } from '../../lib/services/galleryService';
import MediaScopeNote from './MediaScopeNote';

/* ===========================
   相册管理（后台）
   - 只用 --sf-* 令牌：surface/canvas + 四档细线 + 三档墨色 + 单一强调色；
   - 圆角统一 3px（徽标 2px），列表靠 1px 细线分隔，行 hover 只改底色；
   - 状态色只用于语义：显示中 emerald、已隐藏 ink-3、删除 --sf-danger。
   业务逻辑（上传、上下架、删除确认、鉴权分支）与改造前完全一致。
   =========================== */

type Tone = 'neutral' | 'success';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]',
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
};

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[3px] border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY =
  'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_SECONDARY =
  'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const BTN_DANGER =
  'border-[var(--sf-danger)] bg-[var(--sf-surface)] text-[var(--sf-danger)] hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-accent)]';
const BTN_MD = 'min-h-10 px-3 text-[13px]';
const BTN_SM = 'min-h-8 px-2.5 text-[12px]';

const FILTER_ON = 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]';
const FILTER_OFF =
  'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]';

/** 与 ui/Input.tsx 同一套输入样式：surface 底 + 控制线 + 强调色焦点环。 */
const INPUT =
  'min-h-[40px] w-full min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 text-[13px] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-0';
const FILE_INPUT =
  'block w-full min-w-0 cursor-pointer rounded-[3px] border border-dashed border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-[13px] text-[var(--sf-ink-2)] file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:font-mono file:text-[11px] file:tracking-[0.08em] file:text-[var(--sf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]';
const LABEL = 'mb-1 block font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]';

const TABLE_HEAD =
  'border-b border-[var(--sf-line)] bg-[var(--sf-canvas)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TABLE_ROW = 'border-b border-[var(--sf-line-soft)] transition-colors last:border-b-0 hover:bg-[var(--sf-canvas)]';
const TH = 'whitespace-nowrap px-3 py-2 font-medium';
const TD = 'px-3 py-2.5 align-middle';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function GalleryManager() {
  const { user } = useAdminAuth();
  const {
    items,
    loading,
    error,
    status,
    filter,
    uploading,
    uploadState,
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 space-y-4">
      <header className="min-w-0">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 bg-[var(--sf-accent)]" aria-hidden="true" />
          Gallery / Manage
        </p>
        <h1 className="mt-1.5 break-words text-xl font-bold leading-tight tracking-tight text-[var(--sf-ink)]">相册管理</h1>
        <p className="mt-1.5 text-[13px] text-[var(--sf-ink-2)]">管理相册图片的显示与删除</p>
      </header>

      {/* 对外照片墙与素材仓库的边界说明 + 互相跳转 */}
      <MediaScopeNote kind="gallery" />

      {isAuthor && (
        <section className="min-w-0 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">01</span>
            <h2 className="text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]">上传新相片</h2>
            <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">UPLOAD</span>
          </div>
          <form onSubmit={handleUpload} className="space-y-3 p-3">
            <div>
              <label htmlFor="gallery-file" className={LABEL}>图片文件</label>
              <input
                id="gallery-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className={FILE_INPUT}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="gallery-title" className={LABEL}>标题</label>
                <input
                  id="gallery-title"
                  type="text"
                  placeholder="标题（可选）"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={100}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="gallery-album" className={LABEL}>相册</label>
                <input
                  id="gallery-album"
                  type="text"
                  placeholder="相册（可选）"
                  value={newAlbum}
                  onChange={(e) => setNewAlbum(e.target.value)}
                  maxLength={50}
                  className={INPUT}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={uploading} className={cx(BTN_BASE, BTN_PRIMARY, BTN_MD)}>
                {uploading ? '上传中…' : '上传'}
              </button>
              <p className="text-[11px] leading-relaxed text-[var(--sf-ink-3)]">仅允许 JPEG/PNG/WebP/GIF，单文件最大 10MB；上传前会自动压缩到长边 2560px。</p>
            </div>

            {/* 上传进度：压缩阶段没有可量化进度，传输阶段用 xhr.upload.onprogress 的百分比 */}
            {uploading && (
              <div data-state={uploadState.stage} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--sf-ink-2)]">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]" title={uploadState.fileName}>
                    {uploadState.stage === 'compressing'
                      ? `正在压缩 ${uploadState.fileName}…`
                      : `正在上传 ${uploadState.fileName}`}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--sf-ink-3)]">
                    {uploadState.stage === 'compressing' ? '压缩中' : `${uploadState.percent}%`}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="上传进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadState.stage === 'uploading' ? uploadState.percent : undefined}
                  aria-valuetext={uploadState.stage === 'compressing' ? '正在压缩图片' : `${uploadState.percent}%`}
                  className="h-1.5 w-full overflow-hidden rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)]"
                >
                  <div
                    className={cx(
                      'h-full bg-[var(--sf-accent)] transition-[width] duration-200 ease-out',
                      uploadState.stage === 'compressing' && 'animate-pulse'
                    )}
                    style={{ width: uploadState.stage === 'compressing' ? '100%' : `${uploadState.percent}%` }}
                  />
                </div>
                {uploadState.stage === 'uploading' && uploadState.compressedBytes > 0 && (
                  <p className="font-mono text-[10px] tracking-[0.04em] text-[var(--sf-ink-3)]">
                    {uploadState.compressedBytes < uploadState.originalBytes
                      ? `已压缩 ${formatBytes(uploadState.originalBytes)} → ${formatBytes(uploadState.compressedBytes)}`
                      : `${formatBytes(uploadState.compressedBytes)} 原图上传`}
                  </p>
                )}
              </div>
            )}
          </form>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="相册状态筛选">
        {['', 'show', 'hidden'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={cx(
              'min-h-8 rounded-[3px] border px-2.5 font-mono text-[11px] tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]',
              filter === s ? FILTER_ON : FILTER_OFF
            )}
          >
            {s === 'show' ? '显示中' : s === 'hidden' ? '已隐藏' : '全部'}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="break-words rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] px-3 py-2 text-[13px] text-[var(--sf-danger)] [overflow-wrap:anywhere]">
          {error}
        </div>
      )}
      {status && (
        <div className="break-words rounded-[3px] border border-emerald-600/45 bg-[var(--sf-surface)] px-3 py-2 text-[13px] text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300 [overflow-wrap:anywhere]">
          {status}
        </div>
      )}
      {loading && (
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-[var(--sf-ink-3)]">
          <span className="h-1 w-1 animate-pulse bg-[var(--sf-accent)]" aria-hidden="true" />
          加载中…
        </p>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">EMPTY / 0</p>
          <p className="text-[13px] text-[var(--sf-ink-2)]">暂无相片</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="min-w-0 overflow-x-auto rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
          <table className="w-full min-w-[44rem] border-collapse text-[13px]">
            <caption className="sr-only">相册图片列表</caption>
            <thead>
              <tr className={TABLE_HEAD}>
                <th scope="col" className={TH}>预览</th>
                <th scope="col" className={TH}>标题</th>
                <th scope="col" className={TH}>状态</th>
                <th scope="col" className={TH}>创建时间</th>
                <th scope="col" className={cx(TH, 'text-right')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const thumb = photoUrl(item, GALLERY_LIST_THUMB);
                return (
                  <tr key={item.id} className={TABLE_ROW}>
                    <td className={cx(TD, 'w-16')}>
                      <div className="h-10 w-14 overflow-hidden rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)]">
                        {thumb && (
                          <img src={thumb} alt={item.title || ''} className="h-full w-full object-cover" loading="lazy" />
                        )}
                      </div>
                    </td>
                    <td className={cx(TD, 'min-w-[16rem] max-w-[32rem]')}>
                      <p className="break-words font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{item.title || '未命名'}</p>
                      {item.album && <p className="mt-0.5 break-words font-mono text-[11px] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">相册：{item.album}</p>}
                      {item.description && <p className="mt-0.5 break-words text-[12px] leading-snug text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{item.description}</p>}
                    </td>
                    <td className={TD}>
                      <span
                        className={cx(
                          'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]',
                          item.status === 'show' ? TONE_CHIP.success : TONE_CHIP.neutral
                        )}
                      >
                        {item.status === 'show' ? '显示' : '隐藏'}
                      </span>
                    </td>
                    <td className={cx(TD, 'whitespace-nowrap font-mono text-[11px] text-[var(--sf-ink-3)]')}>{fmtDate(item.created)}</td>
                    <td className={cx(TD, 'text-right')}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleStatus(item)}
                          className={cx(BTN_BASE, BTN_SECONDARY, BTN_SM)}
                          title={item.status === 'show' ? '隐藏相片' : '显示相片'}
                          aria-label={item.status === 'show' ? '隐藏相片' : '显示相片'}
                        >
                          {item.status === 'show' ? '隐藏' : '显示'}
                        </button>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => remove(item)}
                            className={cx(BTN_BASE, BTN_DANGER, BTN_SM)}
                            title="删除相片"
                            aria-label="删除相片"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
