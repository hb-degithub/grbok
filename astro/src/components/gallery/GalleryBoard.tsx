import React, { useEffect, useMemo, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import Masonry from '../reactbits/Masonry';
import GalleryLightbox from './GalleryLightbox';
import { useGallery } from '../../hooks/domains/useGallery';
import { EASE_OUT_EXPO } from '../../lib/motion';

const ALL = '__all__';

/** 相册面板：分组筛选（layoutId pill）+ 瀑布流 + 灯箱 */
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
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        相册加载失败，请稍后再试。
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-48 rounded-xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        相册还是空的，等博主上传第一批照片。
      </div>
    );
  }

  const fullUrls = filtered.map((i) => getPhotoUrl(i));

  return (
    <MotionConfig reducedMotion="user">
    <div>
      {/* 分组筛选条 */}
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
                className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  active ? 'text-white dark:text-zinc-950' : 'bg-zinc-100 text-zinc-600 hover:text-zinc-950 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="gallery-album-pill"
                    transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                    className="absolute inset-0 rounded-full bg-zinc-900 dark:bg-zinc-100"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10">{label}</span>
                <span className={`relative z-10 ml-1.5 font-mono text-xs ${active ? 'text-teal-400 dark:text-teal-600' : 'text-zinc-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 瀑布流 */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          这个专辑还没有照片。
        </div>
      ) : (
        <Masonry columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={16}>
          {filtered.map((item, i) => (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group relative block w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900"
              aria-label={item.title ? `查看大图：${item.title}` : '查看大图'}
            >
              <img src={getPhotoUrl(item, '300x300')} alt={item.title || '相册图片'} loading="lazy" className="w-full object-cover" />
              {item.title && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/70 to-transparent px-3 pb-2 pt-8 text-sm font-semibold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
