import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';
import { cn } from '../../lib/utils';

interface PostCardProps {
  post: Post;
  index?: number;
}

/**
 * 文章卡片组件
 * 简约现代设计，带有细腻的悬停效果
 */
export function PostCard({ post, index = 0 }: PostCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  /**
   * 格式化日期
   */
  const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });

  /**
   * 计算阅读时间
   */
  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  /**
   * 入场动画
   */
  const cardVariants = {
    hidden: {
      opacity: 0,
      y: 30,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        delay: index * 0.08,
        ease: [0.25, 0.46, 0.45, 0.94],
      },
    },
  };

  return (
    <motion.article
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group"
    >
      <a href={`/posts/${post.slug}`} className="block">
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white',
            'transition-all duration-300 ease-out',
            'dark:border-zinc-800/80 dark:bg-zinc-900',
            isHovered
              ? '-translate-y-1 border-zinc-300 shadow-lg dark:border-zinc-700'
              : 'shadow-sm'
          )}
        >
          {/* 封面图 */}
          {post.cover && (
            <div className="relative overflow-hidden">
              <motion.img
                src={post.cover}
                alt={post.title}
                className="h-48 w-full object-cover"
                animate={{
                  scale: isHovered ? 1.05 : 1,
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                loading="lazy"
              />
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          )}

          {/* 内容 */}
          <div className="p-5">
            {/* 标题 */}
            <h3 className="mb-2 text-base font-semibold leading-snug text-zinc-900 transition-colors duration-200 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
              {post.title}
            </h3>

            {/* 摘要 */}
            {post.excerpt && (
              <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {post.excerpt}
              </p>
            )}

            {/* 底部信息 */}
            <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
              <div className="flex items-center gap-3">
                <time dateTime={post.published_at}>{formattedDate}</time>
                <span>·</span>
                <span>{readingTime} 分钟</span>
              </div>

              {/* 阅读箭头 */}
              <motion.div
                animate={{ x: isHovered ? 4 : 0, opacity: isHovered ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-indigo-500"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.div>
            </div>
          </div>
        </div>
      </a>
    </motion.article>
  );
}
