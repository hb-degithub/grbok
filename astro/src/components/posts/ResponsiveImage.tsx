/**
 * 响应式图片组件 -- 利用 PocketBase file 字段的 thumb 参数生成多尺寸 srcset。
 *
 * 现有 PostCard 等组件直接用原始图片 URL，此组件为可选替代，
 * 不修改现有组件（遵守资产保全协议）。
 *
 * PocketBase 缩略图语法：/api/files/{collection}/{id}/{filename}?thumb={w}x0
 */

import { useMemo } from 'react';
import { getPocketBase } from '../../lib/pocketbase';

interface ResponsiveImageProps {
  /** PocketBase collection 名（如 'posts'） */
  collection: string;
  /** 记录 ID */
  recordId: string;
  /** 文件名 */
  filename: string;
  /** alt 文本 */
  alt: string;
  /** 附加 class（沿用现有 Tailwind 体系） */
  className?: string;
  /** sizes 属性，默认 (max-width: 640px) 100vw, 50vw */
  sizes?: string;
}

const BREAKPOINTS = [320, 640, 1024, 1600];

export default function ResponsiveImage({
  collection,
  recordId,
  filename,
  alt,
  className,
  sizes = '(max-width: 640px) 100vw, 50vw',
}: ResponsiveImageProps) {
  // 复用 PocketBase 单例的 baseUrl，确保与 SDK 一致
  const { base, srcset } = useMemo(() => {
    const pbUrl = getPocketBase().baseUrl.replace(/\/$/, '');
    // 对路径段做 URL 编码，防止中文/特殊字符文件名损坏
    const enc = (s: string) => encodeURIComponent(s);
    const base = `${pbUrl}/api/files/${enc(collection)}/${enc(recordId)}/${enc(filename)}`;
    const srcset = BREAKPOINTS.map((w) => `${base}?thumb=${w}x0 ${w}w`).join(', ');
    return { base, srcset };
  }, [collection, recordId, filename]);

  return (
    <img
      src={`${base}?thumb=1024x0`}
      srcSet={srcset}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={(e) => {
        // 降级：加载失败时移除 srcset，仅用原始 URL
        const img = e.currentTarget;
        if (img.srcSet) img.removeAttribute('srcset');
      }}
    />
  );
}