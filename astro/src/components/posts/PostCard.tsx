import React from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  index?: number;
}

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
      transition: {
        duration: 0.45,
        delay: index * 0.06,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  return (
    <motion.article
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="group h-full"
    >
      <a href={`/posts/${post.slug}`} className="block h-full">
        <motion.div
          className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900"
          whileHover={{
            y: -4,
            boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.15)',
          }}
          transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
        >
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
            {/* 分类/时间 */}
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                技术
              </span>
              <span>·</span>
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

            <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {readingTime} 分钟阅读
              </span>

              <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 transition-transform duration-200 group-hover:translate-x-1 dark:text-indigo-400">
                阅读
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </div>
        </motion.div>
      </a>
    </motion.article>
  );
}
