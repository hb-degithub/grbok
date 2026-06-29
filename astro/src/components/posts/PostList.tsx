import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import PostCard from './PostCard';

interface PostListProps {
  initialPage?: number;
  perPage?: number;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="glass overflow-hidden rounded-2xl"
      aria-hidden="true"
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

export default function PostList({ initialPage = 1, perPage = 6 }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { posts, loading, error, totalPages } = usePosts(currentPage, perPage);

  const containerVariants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.1 },
    },
  };

  if (loading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2" role="status" aria-live="polite" aria-label="加载中">
        {Array.from({ length: perPage }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
        <span className="sr-only">正在加载文章...</span>
      </div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        role="alert"
        className="glass flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">加载失败，请稍后重试</p>
        <button
          onClick={() => window.location.reload()}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          重试
        </button>
      </motion.div>
    );
  }

  if (posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass flex min-h-[22rem] flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
      >
        <svg className="mb-4 h-12 w-12 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm text-stone-500 dark:text-stone-400">暂无文章</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-10">
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

      {totalPages > 1 && (
        <motion.nav
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-2"
          aria-label="文章分页"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              aria-current={currentPage === page ? 'page' : undefined}
              aria-label={`第 ${page} 页`}
              className={cn(
                'focus-ring flex h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium transition-all duration-200 sm:h-9 sm:min-w-[36px]',
                currentPage === page
                  ? 'glass-strong text-stone-900 dark:text-white'
                  : 'text-stone-500 hover:bg-white/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/5 dark:hover:text-stone-200'
              )}
            >
              {page}
            </button>
          ))}
        </motion.nav>
      )}
    </div>
  );
}
