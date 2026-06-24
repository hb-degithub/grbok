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
 *
 * 设计决策：
 * 1. 玻璃卡片承载评论，hover 时跟随鼠标的 indigo 径向光晕强化「玻璃透光」感。
 * 2. 新评论用 indigo ring + 短暂背景渐隐高亮，3 秒后消退（由父组件控制 isNew）。
 * 3. 回复按钮带 aria-expanded/aria-controls，屏幕阅读器可知展开状态。
 */
export default function CommentItem({
  comment,
  depth = 0,
  maxDepth = 3,
  onSubmitReply,
  isNew = false,
}: CommentItemProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 });

  /** 鼠标移动 - 跟随光晕 */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  /** 相对时间格式化 */
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
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const getAvatarLetter = (name: string) => name.charAt(0).toUpperCase();

  /** 头像配色 - indigo/violet 系，与整体玻璃风格协调 */
  const getAvatarColor = (email: string) => {
    const colors = [
      'bg-indigo-500',
      'bg-violet-500',
      'bg-sky-500',
      'bg-fuchsia-500',
      'bg-purple-500',
      'bg-blue-500',
    ];
    const index = email.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.98 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
    },
  };

  /** 新评论高亮 - indigo 背景渐隐 */
  const highlightVariants = {
    initial: { backgroundColor: 'rgba(99, 102, 241, 0.18)' },
    animate: {
      backgroundColor: 'rgba(99, 102, 241, 0)',
      transition: { duration: 2, ease: 'easeOut' },
    },
  };

  const canReply = depth < maxDepth;

  return (
    <motion.article
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
          'glass relative overflow-hidden rounded-2xl p-5',
          'transition-colors duration-300',
          isNew && 'ring-2 ring-indigo-500/50'
        )}
        {...(isNew && { initial: 'initial', animate: 'animate', variants: highlightVariants })}
      >
        {/* 跟随鼠标的 indigo 光晕 */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-0 rounded-2xl transition-opacity duration-300"
          style={{
            background: `radial-gradient(300px circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, rgba(99, 102, 241, 0.12), transparent 40%)`,
            opacity: isHovered ? 1 : 0,
          }}
          aria-hidden="true"
        />

        <div className="relative z-10">
          {/* 头部：头像 + 作者 + 时间 */}
          <div className="mb-3 flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm',
                getAvatarColor(comment.author_email)
              )}
              aria-hidden="true"
            >
              {getAvatarLetter(comment.author_name)}
            </div>
            <div className="flex-1">
              <p className="font-medium text-zinc-900 dark:text-white">{comment.author_name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                <time dateTime={comment.created}>{formatTime(comment.created)}</time>
              </p>
            </div>
          </div>

          {/* 评论内容 */}
          <div className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {comment.content}
          </div>

          {/* 操作栏 */}
          {canReply && (
            <button
              onClick={() => setIsReplyOpen(!isReplyOpen)}
              aria-expanded={isReplyOpen}
              aria-controls={`reply-form-${comment.id}`}
              className="focus-ring flex items-center gap-1.5 rounded-md text-sm text-zinc-500 transition-colors hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
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

      {/* 子评论（递归渲染） - indigo 竖线引导嵌套关系 */}
      {comment.children.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-indigo-100 pl-6 dark:border-indigo-900/40">
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
    </motion.article>
  );
}
