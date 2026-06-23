import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import PostCard from './PostCard';

interface PostListProps {
  initialPage?: number;
  perPage?: number;
}

/**
 * 骨架屏卡片
 */
function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900"
    >
      <div className="h-48 skeleton" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-3/4 skeleton" />
        <div className="space-y-2">
          <div className="h-3.5 w-full skeleton" />
          <div className="h-3.5 w-2/3 skeleton" />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <div className="h-3 w-12 skeleton" />
          <div className="h-3 w-16 skeleton" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 文章列表组件
 */
export default function PostList({ initialPage = 1, perPage = 6 }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { posts, loading, error, totalPages } = usePosts(currentPage, perPage);

  /**
   * 容器动画
   * 通过 staggerChildren 实现子元素交错入场
   */
  const containerVariants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.06,
        delayChildren: 0.1,
      },
    },
  };

  /**
   * 加载状态 - 骨架屏
   */
  if (loading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: perPage }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  /**
   * 错误状态 - 低调的提示
   */
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          加载失败，请稍后重试
        </span>
        <button
          onClick={() => window.location.reload()}
          className="ml-2 text-sm font-medium text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          重试
        </button>
      </motion.div>
    );
  }

  /**
   * 空状态
   */
  if (posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 py-16 dark:border-zinc-700"
      >
        <svg className="mb-4 h-12 w-12 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          暂无文章
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-10">
      {/* 文章网格 */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-5 sm:grid-cols-2"
      >
        {posts.map((post, index) => (
          <PostCard key={post.id} post={post} index={index} />
        ))}
      </motion.div>

      {/* 分页 */}
      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-2"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={cn(
                'flex h-9 min-w-[36px] items-center justify-center rounded-lg px-3 text-sm font-medium transition-all',
                currentPage === page
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
            >
              {page}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
