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
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
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
   * 最大倾斜角度为 10 度
   */
  const maxTilt = 10;
  const rotateX = (mousePosition.y - 0.5) * -maxTilt;
  const rotateY = (mousePosition.x - 0.5) * maxTilt;

  /**
   * 格式化日期
   */
  const formattedDate = new Date(post.published_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  /**
   * 列表交错入场动画配置
   */
  const cardVariants = {
    hidden: {
      opacity: 0,
      y: 50,
      rotateX: -10,
    },
    visible: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      transition: {
        duration: 0.6,
        delay: index * 0.1, // 交错延迟
        ease: [0.25, 0.46, 0.45, 0.94], // 自定义贝塞尔曲线
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
          stiffness: 300,
          damping: 20,
        }}
        className={cn(
          'relative overflow-hidden rounded-xl border border-gray-200 bg-white',
          'transition-shadow duration-300',
          'dark:border-gray-700 dark:bg-gray-900',
          isHovered
            ? 'shadow-2xl shadow-blue-500/10 dark:shadow-blue-500/5'
            : 'shadow-lg shadow-gray-200/50 dark:shadow-gray-800/50'
        )}
      >
        {/* 边缘光晕效果 */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, rgba(59, 130, 246, 0.15), transparent 40%)`,
          }}
        />

        {/* 卡片内容 */}
        <div className="relative z-20 p-6">
          {/* 封面图 */}
          {post.cover && (
            <div className="relative mb-4 overflow-hidden rounded-lg">
              <motion.img
                src={post.cover}
                alt={post.title}
                className="h-48 w-full object-cover"
                animate={{
                  scale: isHovered ? 1.05 : 1,
                }}
                transition={{ duration: 0.3 }}
                loading="lazy"
              />
              {/* 图片遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
          )}

          {/* 文章信息 */}
          <div className="space-y-3">
            {/* 标题 */}
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
              <a href={`/posts/${post.slug}`} className="block">
                {post.title}
              </a>
            </h3>

            {/* 摘要 */}
            {post.excerpt && (
              <p className="line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                {post.excerpt}
              </p>
            )}

            {/* 底部信息 */}
            <div className="flex items-center justify-between pt-2">
              <time
                dateTime={post.published_at}
                className="text-xs text-gray-500 dark:text-gray-500"
              >
                {formattedDate}
              </time>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {post.views} 阅读
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 底部渐变边框效果 */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          style={{ transformOrigin: 'left' }}
        />
      </motion.div>
    </motion.article>
  );
}
