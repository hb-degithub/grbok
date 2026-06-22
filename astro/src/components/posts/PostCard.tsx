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
 * 实现 3D Tilt 倾斜效果和 Glassmorphism 边缘光晕
 */
export function PostCard({ post, index = 0 }: PostCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 });
  const [isHovered, setIsHovered] = useState(false);

  /**
   * 鼠标移动处理
   * 计算鼠标相对于卡片的位置，用于 3D 倾斜和光晕效果
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setMousePosition({ x, y });
  };

  /**
   * 计算 3D 倾斜角度
   * 最大倾斜角度为 8 度（更细腻）
   */
  const maxTilt = 8;
  const rotateX = (mousePosition.y - 0.5) * -maxTilt;
  const rotateY = (mousePosition.x - 0.5) * maxTilt;

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
   * 列表交错入场动画配置
   */
  const cardVariants = {
    hidden: {
      opacity: 0,
      y: 40,
      rotateX: -5,
    },
    visible: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      transition: {
        duration: 0.6,
        delay: index * 0.1,
        ease: [0.25, 0.46, 0.45, 0.94],
      },
    },
  };

  return (
    <motion.article
      ref={cardRef}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setMousePosition({ x: 0.5, y: 0.5 });
      }}
      className="group relative"
      style={{
        perspective: '1000px',
      }}
    >
      <motion.div
        animate={{
          rotateX: isHovered ? rotateX : 0,
          rotateY: isHovered ? rotateY : 0,
          scale: isHovered ? 1.02 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 25,
        }}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-gray-200/60 bg-white',
          'transition-all duration-300',
          'dark:border-gray-800/60 dark:bg-gray-900',
          isHovered
            ? 'shadow-2xl shadow-blue-500/10 dark:shadow-blue-500/5 border-gray-300 dark:border-gray-700'
            : 'shadow-lg shadow-gray-200/50 dark:shadow-gray-800/50'
        )}
      >
        {/* 边缘光晕效果 */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(500px circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, rgba(59, 130, 246, 0.12), transparent 40%)`,
          }}
        />

        {/* 卡片内容 */}
        <div className="relative z-20">
          {/* 封面图 */}
          {post.cover && (
            <div className="relative overflow-hidden">
              <motion.img
                src={post.cover}
                alt={post.title}
                className="h-52 w-full object-cover"
                animate={{
                  scale: isHovered ? 1.08 : 1,
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                loading="lazy"
              />
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

              {/* 阅读时间标签 */}
              <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur-sm">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {readingTime} 分钟
              </div>
            </div>
          )}

          {/* 文章信息 */}
          <div className="p-6">
            {/* 标题 */}
            <h3 className="mb-3 text-xl font-bold leading-tight text-gray-900 transition-colors duration-200 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
              <a href={`/posts/${post.slug}`} className="block">
                {post.title}
              </a>
            </h3>

            {/* 摘要 */}
            {post.excerpt && (
              <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {post.excerpt}
              </p>
            )}

            {/* 底部信息 */}
            <div className="flex items-center justify-between">
              <time
                dateTime={post.published_at}
                className="text-xs text-gray-500 dark:text-gray-500"
              >
                {formattedDate}
              </time>

              {/* 阅读链接 */}
              <a
                href={`/posts/${post.slug}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-all hover:gap-2 dark:text-blue-400"
              >
                阅读全文
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* 底部渐变边框效果 */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isHovered ? 1 : 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          style={{ transformOrigin: 'left' }}
        />
      </motion.div>
    </motion.article>
  );
}
