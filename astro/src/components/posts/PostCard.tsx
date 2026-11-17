import React from 'react';
import { motion, MotionConfig, type Variants } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  /** 0 基位置，仅用于入场动效的错峰延迟。 */
  index?: number;
  /**
   * 展示用序号（1 基）。
   * 缺省为 index + 1；分页列表由 PostList 传入跨页连续序号，避免每页从 01 重来。
   */
  ordinal?: number;
}

/**
 * 文章行组件 —— 科幻简约改造后的「编号行」。
 *
 * 设计决策：
 * 1. 形态：编号 + 标题 + 摘要 + 元信息收进一条细线分隔的行，替代原来的
 *    玻璃拟态卡片；不再有圆角容器、内高光、上浮阴影。
 * 2. 信息层级：序号（等宽小字）→ 标题 → 摘要 → 标签 / 日期 / 阅读时长。
 *    封面改为小缩略图，避免它压过标题。
 * 3. 结构色全部走共享令牌 var(--sf-*)，深浅主题随 .dark 自动切换；
 *    唯一强调色只出现在 hover 的标题与箭头上。
 * 4. 整行仍是单个 <a>，保留 aria-label 与键盘焦点（全局 :focus-visible 轮廓）。
 */
const makeRowVariants = (index: number): Variants => ({
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, delay: Math.min(index, 12) * 0.04, ease: [0.22, 0.61, 0.36, 1] },
  },
});

/** 序号两位补零；非法输入回落到 01，保证列表不会出现空编号。 */
function formatOrdinal(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
  return String(safe).padStart(2, '0');
}

export default function PostCard({ post, index = 0, ordinal }: PostCardProps) {
  const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  // 标签徽标：兼容两种历史数据形态（关联记录的 expand.tag_id 或记录自身 name）。
  const firstPostTag = post.expand?.['post_tags(post_id)']?.[0];
  const tagName =
    firstPostTag?.expand?.tag_id?.name ??
    (firstPostTag as unknown as { name?: string } | undefined)?.name;

  const ordinalLabel = formatOrdinal(ordinal ?? index + 1);
  const rowVariants = makeRowVariants(index);

  return (
    // reducedMotion="user"：保留入场动效接口，但跟随系统「减少动态效果」设置降级。
    <MotionConfig reducedMotion="user">
      <motion.article variants={rowVariants} initial="hidden" animate="visible" className="group">
        <a
          href={`/posts/${post.slug}`}
          aria-label={`阅读文章：${post.title}`}
          className="block border-b border-[var(--sf-line-soft)] py-5 no-underline transition-colors duration-200 hover:bg-[var(--sf-surface)] focus-visible:bg-[var(--sf-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] sm:py-6"
        >
          <div className="flex items-start gap-x-4 gap-y-3 sm:items-center sm:gap-x-6">
            {/* 编号索引 */}
            <span
              aria-hidden="true"
              className="w-8 shrink-0 pt-1 font-mono text-[11px] leading-none tracking-[0.12em] text-[var(--sf-ink-3)] sm:pt-0"
            >
              {ordinalLabel}
            </span>

            {/* 封面缩略 */}
            {post.cover && (
              <div className="h-14 w-20 shrink-0 overflow-hidden border border-[var(--sf-line-soft)] sm:h-20 sm:w-28">
                <img
                  src={post.cover}
                  alt={post.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                />
              </div>
            )}

            {/* 正文 */}
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-[1.0625rem] font-semibold leading-snug text-[var(--sf-ink)] transition-colors duration-200 [overflow-wrap:anywhere] group-hover:text-[var(--sf-accent-ink)] sm:text-lg">
                {post.title}
              </h3>

              {post.excerpt && (
                <p className="mt-1.5 line-clamp-2 break-words text-sm leading-relaxed text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">
                  {post.excerpt}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]">
                {tagName && (
                  <span className="border border-[var(--sf-line)] px-1.5 py-0.5 text-[var(--sf-ink-2)]">
                    {tagName}
                  </span>
                )}
                <time dateTime={post.published_at}>{formattedDate}</time>
                <span aria-hidden="true" className="text-[var(--sf-line-strong)]">
                  /
                </span>
                <span>{readingTime} 分钟阅读</span>
              </div>
            </div>

            {/* 进入提示：只在桌面显示，hover 时右移并转为强调色 */}
            <span
              aria-hidden="true"
              className="hidden shrink-0 font-mono text-sm text-[var(--sf-line-control)] transition-transform duration-200 ease-out group-hover:translate-x-1 group-hover:text-[var(--sf-accent)] sm:block"
            >
              →
            </span>
          </div>
        </a>
      </motion.article>
    </MotionConfig>
  );
}
