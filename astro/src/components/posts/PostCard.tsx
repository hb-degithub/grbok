import React from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  index?: number;
}

/**
 * 文章卡片组件
 * 物理悬停：translateY(-3px) + 阴影 + 图片缩放
 */
export function PostCard({ post, index = 0 }: PostCardProps) {
  const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });

  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  /**
   * 入场动画变体
   * 仅使用 transform + opacity
   */
  const cardVariants = {
    hidden: {
      opacity: 0,
      y: 12,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.45,
        delay: index * 0.06,
        ease: [0.16, 1, 0.3, 1], // Ease-Out-Expo
      },
    },
  };

  return (
    <motion.article
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="group"
      style={{ willChange: 'transform' }}
    >
      <a href={`/posts/${post.slug}`} className="block">
        <motion.div
          className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900"
          // 物理悬停：抬起 + 阴影
          whileHover={{
            y: -3,
            boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 4px 10px -4px rgb(0 0 0 / 0.05)',
          }}
          whileTap={{ y: -1 }}
          transition={{
            type: 'tween',
            duration: 0.2,
            ease: [0, 0, 0.2, 1],
          }}
        >
          {/* 封面图 */}
          {post.cover && (
            <div className="relative overflow-hidden">
              <motion.img
                src={post.cover}
                alt={post.title}
                className="h-48 w-full object-cover"
                whileHover={{ scale: 1.05 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          )}

          {/* 内容 */}
          <div className="p-5">
            <h3 className="mb-2 text-base font-semibold leading-snug text-zinc-900 transition-colors duration-200 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
              {post.title}
            </h3>

            {post.excerpt && (
              <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {post.excerpt}
              </p>
            )}

            <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
              <div className="flex items-center gap-3">
                <time dateTime={post.published_at}>{formattedDate}</time>
                <span>·</span>
                <span>{readingTime} 分钟</span>
              </div>

              <motion.div
                initial={{ x: 0, opacity: 0 }}
                whileHover={{ x: 4, opacity: 1 }}
                className="text-indigo-500"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </a>
    </motion.article>
  );
}
