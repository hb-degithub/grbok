import React from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  index?: number;
}

/**
 * 文章卡片组件
 *
 * 设计决策：
 * 1. 玻璃拟态：半透明背景 + backdrop-blur + 内高光边框，让卡片「浮」在
 *    页面 aurora 背景之上。hover 时边框提亮 + 上浮 + 阴影加深，三层反馈。
 * 2. 信息层级：封面图 > 标题（lg semibold）> 摘要（sm 次要色）> 元信息（xs），
 *    用户 3 秒内可抓取标题。
 * 3. 整卡可点击（a 标签包裹），focus-visible 暴露焦点环，键盘可达。
 */
export default function PostCard({ post, index = 0 }: PostCardProps) {
  const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  const cardVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] },
    },
  };

  return (
    <motion.article variants={cardVariants} initial="hidden" animate="visible" className="group h-full">
      <a
        href={`/posts/${post.slug}`}
        className="focus-ring block h-full rounded-2xl"
        aria-label={`阅读文章：${post.title}`}
      >
        <motion.div
          className="glass relative flex h-full flex-col overflow-hidden rounded-2xl transition-colors duration-300 group-hover:border-white/70 dark:group-hover:border-white/20"
          whileHover={{ y: -4 }}
          transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
        >
          {/* 顶部高光线 */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/15"
            aria-hidden="true"
          />

          {/* 封面图 */}
          {post.cover && (
            <div className="relative aspect-[16/10] overflow-hidden">
              <motion.img
                src={post.cover}
                alt={post.title}
                className="h-full w-full object-cover"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          )}

          {/* 内容 */}
          <div className="flex flex-1 flex-col p-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
                技术
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={post.published_at}>{formattedDate}</time>
            </div>

            <h3 className="mb-2 flex-1 text-lg font-semibold leading-snug text-zinc-900 transition-colors duration-200 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
              {post.title}
            </h3>

            {post.excerpt && (
              <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {post.excerpt}
              </p>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-zinc-200/60 pt-4 dark:border-zinc-700/50">
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{readingTime} 分钟阅读</span>
              <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 transition-transform duration-200 group-hover:translate-x-1 dark:text-indigo-400">
                阅读
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </div>
        </motion.div>
      </a>
    </motion.article>
  );
}
