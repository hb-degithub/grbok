import React, { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import type { NestedComment, CommentFormData } from '../../types/pocketbase';
import ReplyForm from './ReplyForm';
import { cn } from '../../lib/utils';
import { sanitizeText } from '../../lib/security';
import { commentService } from '../../lib/services/commentService';
import LevelBadge from '../ui/LevelBadge';

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
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
  /** 服务端返回的提交错误文案（来自 useComments.submitError），无文案时为 null */
  serverError?: string | null;
  /** 当前用户邮箱（用于判断是否显示编辑/删除按钮） */
  currentUserEmail?: string;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

/** 新评论高亮 - stone 背景渐隐 */
const highlightVariants: Variants = {
  initial: { backgroundColor: 'rgba(120, 113, 108, 0.15)' },
  animate: {
    backgroundColor: 'rgba(120, 113, 108, 0)',
    transition: { duration: 2, ease: 'easeOut' },
  },
};

/**
 * 单条评论组件
 *
 * 设计决策：
 * 1. 玻璃卡片承载评论，hover 时跟随鼠标的 teal 径向光晕强化「玻璃透光」感。
 * 2. 新评论用 teal ring + 短暂背景渐隐高亮，3 秒后消退（由父组件控制 isNew）。
 * 3. 回复按钮带 aria-expanded/aria-controls，屏幕阅读器可知展开状态。
 */
export default function CommentItem({
  comment,
  depth = 0,
  maxDepth = 3,
  onSubmitReply,
  isNew = false,
  moderationEnabled = true,
  serverError,
  currentUserEmail,
}: CommentItemProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 });
  const [likes, setLikes] = useState(comment.likes || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleteVerificationCode, setDeleteVerificationCode] = useState('');
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [isSendingDeleteCode, setIsSendingDeleteCode] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isOwner = false; // TODO: 通过 PocketBase 认证判断是否为评论作者
  const isDeleted = comment.deleted;
  const isEdited = comment.edited;

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

  /** 头像配色 - teal/violet 系，与整体玻璃风格协调 */
  const getAvatarColor = (seed: string) => {
    const colors = [
      'bg-zinc-500',
      'bg-zinc-600',
      'bg-zinc-400',
      'bg-zinc-500',
      'bg-zinc-600',
      'bg-zinc-400',
    ];
    const index = seed.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const canReply = depth < maxDepth;

  /** 点赞 */
  const handleLike = async () => {
    if (isLiked || isLiking || isDeleted) return;
    setIsLiking(true);
    try {
      const result = await commentService.likeComment(comment.id);
      setLikes(result.likes);
      setIsLiked(true);
    } catch (err) {
      console.error('点赞失败:', err);
    } finally {
      setIsLiking(false);
    }
  };

  /** 举报 */
  const handleReport = async () => {
    if (!reportReason.trim() || isReporting) return;
    setIsReporting(true);
    try {
      await commentService.reportComment(comment.id, reportReason.trim());
      setReportSubmitted(true);
      setShowReportForm(false);
      setReportReason('');
    } catch (err) {
      console.error('举报失败:', err);
    } finally {
      setIsReporting(false);
    }
  };

  /** 编辑 */
  const handleEdit = async () => {
    if (!editContent.trim() || isSaving) return;
    if (!verificationCode.trim()) {
      setEditError('请输入验证码');
      return;
    }
    setIsSaving(true);
    setEditError('');
    try {
      await commentService.editComment(comment.id, editContent.trim(), editEmail, verificationCode.trim());
      setIsEditing(false);
      // 更新本地显示
      comment.content = editContent.trim();
      comment.edited = true;
    } catch (err) {
      console.error('编辑失败:', err);
      setEditError('编辑失败，请检查验证码是否正确');
    } finally {
      setIsSaving(false);
    }
  };

  /** 删除 */
  const handleDelete = async () => {
    if (isDeleting) return;
    if (!deleteVerificationCode.trim()) {
      setDeleteError('请输入验证码');
      return;
    }
    setIsDeleting(true);
    setDeleteError('');
    try {
      await commentService.deleteComment(comment.id, deleteEmail, deleteVerificationCode.trim());
      setShowDeleteConfirm(false);
      // 标记为已删除
      comment.deleted = true;
    } catch (err) {
      console.error('删除失败:', err);
      setDeleteError('删除失败，请检查验证码是否正确');
    } finally {
      setIsDeleting(false);
    }
  };

  /** 发送编辑验证码 */
  const handleSendEditCode = async () => {
    if (!editEmail.trim() || isSendingCode) return;
    setIsSendingCode(true);
    setEditError('');
    try {
      await commentService.sendVerificationCode(editEmail.trim());
      setCodeSent(true);
    } catch (err) {
      console.error('发送验证码失败:', err);
      setEditError('发送验证码失败，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  };

  /** 发送删除验证码 */
  const handleSendDeleteCode = async () => {
    if (!deleteEmail.trim() || isSendingDeleteCode) return;
    setIsSendingDeleteCode(true);
    setDeleteError('');
    try {
      await commentService.sendVerificationCode(deleteEmail.trim());
      setDeleteCodeSent(true);
    } catch (err) {
      console.error('发送验证码失败:', err);
      setDeleteError('发送验证码失败，请稍后重试');
    } finally {
      setIsSendingDeleteCode(false);
    }
  };

  // 已删除的评论不显示
  if (isDeleted) {
    return null;
  }

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
          'card relative overflow-hidden rounded-lg p-4 sm:p-5',
          'transition-colors duration-300',
          isNew && 'ring-2 ring-zinc-400/50'
        )}
        {...(isNew && { initial: 'initial', animate: 'animate', variants: highlightVariants })}
      >
        {/* 跟随鼠标的柔和光晕 */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-0 rounded-lg transition-opacity duration-300"
          style={{
            background: `radial-gradient(300px circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, rgba(120, 113, 108, 0.10), transparent 40%)`,
            opacity: isHovered ? 1 : 0,
          }}
          aria-hidden="true"
        />

        <div className="relative z-10">
          {/* 头部：头像 + 作者 + 时间 */}
          <div className="mb-3 flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm',
                getAvatarColor(comment.id || comment.author_name)
              )}
              aria-hidden="true"
            >
              {getAvatarLetter(comment.author_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="break-words font-medium text-zinc-900 dark:text-white">{comment.author_name}</p>
                {comment.author_level && <LevelBadge level={comment.author_level} size="sm" />}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                <time dateTime={comment.created}>{formatTime(comment.created)}</time>
              </p>
            </div>
          </div>

          {/* 评论内容 */}
          <div className="mb-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
            {sanitizeText(comment.content)}
            {isEdited && (
              <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500" title={comment.edited_at ? `编辑于 ${new Date(comment.edited_at).toLocaleString('zh-CN')}` : '已编辑'}>
                （已编辑）
              </span>
            )}
          </div>

          {/* 操作栏 */}
          <div className="flex items-center gap-4">
            {/* 点赞 */}
            <button
              onClick={handleLike}
              disabled={isLiked || isLiking}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors',
                isLiked
                  ? 'text-teal-600 dark:text-teal-400'
                  : 'text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500'
              )}
              aria-label={isLiked ? '已点赞' : '点赞'}
            >
              <svg className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {likes > 0 && <span>{likes}</span>}
            </button>

            {/* 回复 */}
            {canReply && (
              <button
                onClick={() => setIsReplyOpen(!isReplyOpen)}
                aria-expanded={isReplyOpen}
                aria-controls={`reply-form-${comment.id}`}
                className="focus-ring min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 rounded-md text-sm text-zinc-500 transition-colors hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-500"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                回复
              </button>
            )}

            {/* 举报 */}
            {!isOwner && (
              <button
                onClick={() => setShowReportForm(!showReportForm)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-zinc-400 transition-colors hover:text-zinc-500 dark:text-zinc-500 dark:hover:text-zinc-400"
                aria-label="举报"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                举报
              </button>
            )}

            {/* 编辑（仅作者） */}
            {isOwner && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-zinc-400 transition-colors hover:text-zinc-500 dark:text-zinc-500 dark:hover:text-zinc-400"
                aria-label="编辑"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                编辑
              </button>
            )}

            {/* 删除（仅作者） */}
            {isOwner && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-red-400 transition-colors hover:text-red-500 dark:text-red-500 dark:hover:text-red-400"
                aria-label="删除"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除
              </button>
            )}
          </div>
        </div>

        {/* 回复表单 */}
        <ReplyForm
          isOpen={isReplyOpen}
          onClose={() => setIsReplyOpen(false)}
          onSubmit={onSubmitReply}
          parentId={comment.id}
          moderationEnabled={moderationEnabled}
          serverError={serverError}
        />

        {/* 举报表单 */}
        {showReportForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="请说明举报原因..."
              rows={2}
              maxLength={500}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleReport}
                disabled={!reportReason.trim() || isReporting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isReporting ? '提交中...' : '提交举报'}
              </button>
              <button
                onClick={() => setShowReportForm(false)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400"
              >
                取消
              </button>
            </div>
          </motion.div>
        )}

        {/* 举报成功提示 */}
        {reportSubmitted && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-2 text-xs text-emerald-600 dark:text-emerald-400"
          >
            举报已提交，感谢反馈
          </motion.p>
        )}

        {/* 编辑表单 */}
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            />
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="你的邮箱"
                  className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                />
                <button
                  onClick={handleSendEditCode}
                  disabled={!editEmail.trim() || isSendingCode || codeSent}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400"
                >
                  {isSendingCode ? '发送中...' : codeSent ? '已发送' : '发送验证码'}
                </button>
              </div>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="6 位验证码"
                maxLength={6}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
              {editError && <p className="text-xs text-red-500">{editError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleEdit}
                  disabled={!editContent.trim() || !verificationCode.trim() || isSaving}
                  className="rounded-md bg-teal-600 px-3 py-1.5 text-xs text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditContent(comment.content); setEditEmail(''); setVerificationCode(''); setCodeSent(false); setEditError(''); }}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400"
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* 删除确认 */}
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
          >
            <p className="text-sm text-red-700 dark:text-red-400">确定删除这条评论吗？此操作不可撤销。</p>
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={deleteEmail}
                  onChange={(e) => setDeleteEmail(e.target.value)}
                  placeholder="你的邮箱"
                  className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                />
                <button
                  onClick={handleSendDeleteCode}
                  disabled={!deleteEmail.trim() || isSendingDeleteCode || deleteCodeSent}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400"
                >
                  {isSendingDeleteCode ? '发送中...' : deleteCodeSent ? '已发送' : '发送验证码'}
                </button>
              </div>
              <input
                type="text"
                value={deleteVerificationCode}
                onChange={(e) => setDeleteVerificationCode(e.target.value)}
                placeholder="6 位验证码"
                maxLength={6}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
              {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={!deleteVerificationCode.trim() || isDeleting}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? '删除中...' : '确认删除'}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteEmail(''); setDeleteVerificationCode(''); setDeleteCodeSent(false); setDeleteError(''); }}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400"
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* 子评论（递归渲染） - teal 竖线引导嵌套关系 */}
      {comment.children.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800/60 sm:pl-6">
          {comment.children.map((child) => (
            <CommentItem
              key={child.id}
              comment={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              onSubmitReply={onSubmitReply}
              moderationEnabled={moderationEnabled}
              serverError={serverError}
            />
          ))}
        </div>
      )}
    </motion.article>
  );
}
