import React, { useEffect, useMemo, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import Masonry from '../reactbits/Masonry';
import GalleryLightbox from './GalleryLightbox';
import { useGallery } from '../../hooks/domains/useGallery';
import { EASE_OUT_EXPO } from '../../lib/motion';

const ALL = '__all__';

/** 细线面板：加载失败 / 空态 / 单专辑空态共用，保持三态视觉一致 */
function StatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center text-sm text-[var(--sf-ink-3)]">
      {children}
    </div>
  );
}

/** 相册面板：分组筛选（layoutId 滑片）+ 瀑布流 + 灯箱 */
export default function GalleryBoard() {
  const { items, loading, error, setFilter, getPhotoUrl } = useGallery();
  const [album, setAlbum] = useState<string>(ALL);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 仅展示已显示的照片，与原直接查询 status = "show" 保持一致
  useEffect(() => {
    setFilter('show');
  }, [setFilter]);

  const albums = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.album && i.album.trim()) set.add(i.album.trim());
    });
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    if (album === ALL) return items;
    return items.filter((i) => (i.album || '').trim() === album);
  }, [items, album]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      const key = (i.album || '').trim();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [items]);

  // 筛选变化时关闭灯箱，避免索引错位
  useEffect(() => {
    setLightboxIndex(null);
  }, [album]);

  if (error) {
    return <StatePanel>相册加载失败，请稍后再试。</StatePanel>;
  }

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-48 rounded-[3px]" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <StatePanel>相册还是空的，等博主上传第一批照片。</StatePanel>;
  }

  const fullUrls = filtered.map((i) => getPhotoUrl(i));

  return (
    <MotionConfig reducedMotion="user">
    <div>
      {/* 分组筛选条：细线方角标签，选中态用唯一强调色实底 */}
      {albums.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="按专辑筛选">
          {[ALL, ...albums].map((name) => {
            const active = album === name;
            const label = name === ALL ? '全部' : name;
            const count = name === ALL ? items.length : counts.get(name) || 0;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setAlbum(name)}
                className={`focus-ring relative inline-flex min-h-11 items-center rounded-[3px] border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[var(--sf-accent)] text-[var(--sf-on-accent)]'
                    : 'border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="gallery-album-pill"
                    transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                    className="absolute inset-0 rounded-[3px] bg-[var(--sf-accent)]"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10">{label}</span>
                <span className={`relative z-10 ml-1.5 font-mono text-xs ${active ? 'text-[var(--sf-on-accent)] opacity-80' : 'text-[var(--sf-ink-3)]'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 瀑布流：列数沿用 Masonry 的 1 / 2 / 3 断点，图片容器只有细线描边与方角 */}
      {filtered.length === 0 ? (
        <StatePanel>这个专辑还没有照片。</StatePanel>
      ) : (
        <Masonry columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={16}>
          {filtered.map((item, i) => (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              whileTap={{ opacity: 0.88 }}
              className="focus-ring group relative block w-full overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] text-left transition-colors duration-200 hover:border-[var(--sf-accent)]"
              aria-label={item.title ? `查看大图：${item.title}` : '查看大图'}
            >
              <img
                src={getPhotoUrl(item, '300x300')}
                alt={item.title || '相册图片'}
                loading="lazy"
                className="w-full object-cover transition-opacity duration-200 group-hover:opacity-95"
              />
              {item.title && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-2 text-xs font-medium text-[var(--sf-ink-2)] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {item.title}
                </span>
              )}
            </motion.button>
          ))}
        </Masonry>
      )}

      <GalleryLightbox items={filtered} urls={fullUrls} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onNavigate={setLightboxIndex} />
    </div>
    </MotionConfig>
  );
}
