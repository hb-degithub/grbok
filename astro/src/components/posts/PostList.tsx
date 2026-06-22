import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import { PostCard } from './PostCard';
import { Button } from '../ui/Button';

interface PostListProps {
  initialPage?: number;
  perPage?: number;
}

/**
 * 文章列表组件
 * 实现卡片交错入场、加载状态和分页功能
 */
export function PostList({ initialPage = 1, perPage = 10 }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { posts, loading, error, totalPages } = usePosts(currentPage, perPage);

  /**
   * 容器动画配置
   * 控制整个列表的入场动画
   */
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1, // 子元素交错延迟
      },
    },
  };

  /**
   * 加载状态骨架屏
   */
  if (loading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2">
        {Array.from({ length: perPage }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
          />
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
        className="rounded-lg bg-red-50 p-6 text-center dark:bg-red-900/20"
      >
        <p className="text-red-600 dark:text-red-400">
          加载失败: {error.message}
        </p>
        <Button
          variant="ghost"
          onClick={() => window.location.reload()}
          className="mt-4"
        >
          重试
        </Button>
      </motion.div>
    );
  }

  /**
   * 空状态
   */
  if (posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-gray-50 p-12 text-center dark:bg-gray-900"
      >
        <p className="text-gray-500 dark:text-gray-400">
          暂无文章
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 文章网格 */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-6 sm:grid-cols-2"
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
          className="flex items-center justify-center gap-4"
        >
          <Button
            variant="outline"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            上一页
          </Button>

          <span className="text-sm text-gray-600 dark:text-gray-400">
            第 {currentPage} / {totalPages} 页
          </span>

          <Button
            variant="outline"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            下一页
          </Button>
        </motion.div>
      )}
    </div>
  );
}
