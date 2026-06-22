import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { NestedComment, CommentFormData } from '../../types/pocketbase';
import { ReplyForm } from './ReplyForm';
import { cn } from '../../lib/utils';

interface CommentItemProps {
  /** 评论数据（含嵌套子评论） */
  comment: NestedComment;
  /** 嵌套层级（用于缩进） */
  depth?: number;
  /** 最大嵌套层级 */
  maxDepth?: number;
  /** 提交回复回调 */
  onSubmitReply: (data: CommentFormData) => Promise<boolean>;
  /** 是否为新评论（用于高亮效果） */
  isNew?: boolean;
}

/**
 * 单条评论组件
 * 实现 3D 光晕效果、嵌套缩进和新评论高亮
 */
export function CommentItem({
  comment,
  depth = 0,
  maxDepth = 3,
  onSubmitReply,
  isNew = false,
}: CommentItemProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 });

  /**
   * 鼠标移动处理
   * 用于边缘光晕效果
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setMousePosition({ x, y });
  };

  /**
   * 格式化时间
   */
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;

    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  /**
   * 生成头像（基于邮箱的首字母）
   */
  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  /**
   * 生成头像颜色（基于邮箱哈希）
   */
  const getAvatarColor = (email: string) => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-orange-500',
      'bg-teal-500',
    ];
    const index = email.charCodeAt(0) % colors.length;
    return colors[index];
  };

  /**
   * 评论项动画配置
   */
  const itemVariants = {
    hidden: {
      opacity: 0,
      y: 20,
      scale: 0.98,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      },
    },
  };

  /**
   * 新评论高亮动画
   */
  const highlightVariants = {
    initial: {
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
    },
    animate: {
      backgroundColor: 'rgba(59, 130, 246, 0)',
      transition: {
        duration: 2,
        ease: 'easeOut',
      },
    },
  };

  const canReply = depth < maxDepth;

  return (
    <motion.div
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative"
    >
      <motion.div
        className={cn(
          'relative rounded-xl p-4',
          'border border-gray-200 dark:border-gray-700',
          'transition-all duration-300',
          isNew && 'ring-2 ring-blue-500/50'
        )}
        // 新评论高亮效果
        {...(isNew && {
          initial: 'initial',
          animate: 'animate',
          variants: highlightVariants,
        })}
      >
        {/* 边缘光晕效果 */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-0 rounded-xl opacity-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(300px circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, rgba(59, 130, 246, 0.1), transparent 40%)`,
            opacity: isHovered ? 1 : 0,
          }}
        />

        {/* 评论内容 */}
        <div className="relative z-10">
          {/* 头部：头像 + 作者 + 时间 */}
          <div className="mb-3 flex items-center gap-3">
            {/* 头像 */}
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white',
                getAvatarColor(comment.author_email)
              )}
            >
              {getAvatarLetter(comment.author_name)}
            </div>

            {/* 作者信息 */}
            <div className="flex-1">
              <p className="font-medium text-gray-900 dark:text-white">
                {comment.author_name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatTime(comment.created)}
              </p>
            </div>
          </div>

          {/* 评论内容 */}
          <div className="mb-3 text-gray-700 dark:text-gray-300">
            {comment.content}
          </div>

          {/* 操作栏 */}
          {canReply && (
            <button
              onClick={() => setIsReplyOpen(!isReplyOpen)}
              className="flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                />
              </svg>
              回复
            </button>
          )}
        </div>

        {/* 回复表单 */}
        <ReplyForm
          isOpen={isReplyOpen}
          onClose={() => setIsReplyOpen(false)}
          onSubmit={onSubmitReply}
          parentId={comment.id}
        />
      </motion.div>

      {/* 子评论（递归渲染） */}
      {comment.children.length > 0 && (
        <div className="mt-3 space-y-3 pl-6 border-l-2 border-gray-100 dark:border-gray-800">
          {comment.children.map((child) => (
            <CommentItem
              key={child.id}
              comment={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              onSubmitReply={onSubmitReply}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
