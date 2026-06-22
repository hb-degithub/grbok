import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import { PostCard } from './PostCard';
import { Button } from '../ui/Button';

interface PostListProps {
  initialPage?: number;
  perPage?: number;
}

/**
 * 骨架屏卡片组件
 * 用于加载状态的占位符
 */
function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white dark:border-gray-800/60 dark:bg-gray-900"
    >
      {/* 图片骨架 */}
      <div className="h-52 skeleton" />

      {/* 内容骨架 */}
      <div className="space-y-3 p-6">
        <div className="h-6 w-3/4 skeleton" />
        <div className="space-y-2">
          <div className="h-4 w-full skeleton" />
          <div className="h-4 w-2/3 skeleton" />
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="h-3 w-16 skeleton" />
          <div className="h-3 w-20 skeleton" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 文章列表组件
 * 实现卡片交错入场、加载状态和分页功能
 */
export function PostList({ initialPage = 1, perPage = 6 }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { posts, loading, error, totalPages } = usePosts(currentPage, perPage);

  /**
   * 容器动画配置
   */
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
    },
  };

  /**
   * 加载状态 - 优雅的骨架屏
   */
  if (loading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2">
        {Array.from({ length: perPage }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  /**
   * 错误状态
   */
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-12 text-center dark:border-red-800 dark:bg-red-900/20"
      >
        {/* 错误图标 */}
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
          <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">
          加载失败
        </h3>
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
          className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40"
        >
          重试
        </Button>
      </motion.div>
    );
  }

  /**
   * 空状态 - 优雅的提示
   */
  if (posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 p-16 text-center dark:border-gray-800 dark:bg-gray-900"
      >
        {/* 空状态图标 */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
          <svg className="h-10 w-10 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        </div>
        <h3 className="mb-2 text-xl font-semibold text-gray-700 dark:text-gray-300">
          暂无文章
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          还没有发布任何文章，请稍后再来看看
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
        className="grid gap-8 sm:grid-cols-2"
      >
        {posts.map((post, index) => (
          <PostCard key={post.id} post={post} index={index} />
        ))}
      </motion.div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-3"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-xl"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            上一页
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-medium transition-all ${
                    currentPage === page
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  {page}
                </button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-xl"
          >
            下一页
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </motion.div>
      )}
    </div>
  );
}
