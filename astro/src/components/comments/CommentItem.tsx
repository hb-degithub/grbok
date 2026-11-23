import React, { useState, useEffect, useRef } from 'react';
import { motion, type Variants } from 'framer-motion';
import type { NestedComment } from '../../types/pocketbase';
import type { CommentSubmitHandler } from '../../hooks/useComments';
import ReplyForm from './ReplyForm';
import { cn } from '../../lib/utils';
import { sanitizeText } from '../../lib/security';
import { commentService } from '../../lib/services/commentService';
import { isAuthRequiredError, isRateLimitedError } from '../../lib/services/actionRequest';
import { getPocketBase } from '../../lib/pocketbase';
import LevelBadge from '../ui/LevelBadge';
import AltchaField from '../auth/AltchaField';
import { useAltchaGate } from '../../hooks/useAltchaGate';
import { captchaErrorMessage, isCaptchaError } from '../../lib/captcha';

interface CommentItemProps {
  /** 评论数据（含嵌套子评论） */
  comment: NestedComment;
  /** 嵌套层级（用于缩进） */
  depth?: number;
  /** 最大嵌套层级 */
  maxDepth?: number;
  /** 提交回复回调 */
  onSubmitReply: CommentSubmitHandler;
  /** 是否为新评论（用于高亮效果） */
  isNew?: boolean;
  /** 当前高亮的新评论 id 集合：嵌套子评论也要传递 isNew */
  newCommentIds?: Set<string>;
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
  /** 服务端返回的提交错误文案（来自 useComments.submitError），无文案时为 null */
  serverError?: string | null;
  /** 当前用户邮箱（用于判断是否显示编辑/删除按钮） */
  currentUserEmail?: string;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

/** 小号次操作按钮：细线 + 小圆角，颜色全部走 --sf-* 令牌 */
const actionButtonClass =
  'focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[2px] border border-transparent px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-ink-3)] transition-colors hover:border-[var(--sf-line)] hover:text-[var(--sf-ink-2)] sm:min-h-9 sm:min-w-0';

/** 小号输入框：细线 + 聚焦强调色 */
const inputClass =
  'w-full rounded-[2px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-1.5 text-xs text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] outline-none transition-colors focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]';

/** 小号次按钮：取消/发送验证码 */
const secondarySmallButtonClass =
  'focus-ring inline-flex min-h-9 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50';

/**
 * 单条评论组件
 *
 * 设计决策：
 * 1. 细线卡片承载评论：1px 冷灰边 + 2–3px 小圆角，无玻璃、无阴影、无光晕。
 * 2. 新评论用强调色细边 + 等宽 NEW 标记提示，3 秒后消退（由父组件控制 isNew）。
 * 3. 回复按钮带 aria-expanded/aria-controls，屏幕阅读器可知展开状态。
 * 4. 语义红/绿只用于文字：错误可辨识，但不引入红色大色块。
 */
export default function CommentItem({
  comment,
  depth = 0,
  maxDepth = 3,
  onSubmitReply,
  isNew = false,
  newCommentIds,
  moderationEnabled = true,
  serverError,
  currentUserEmail,
}: CommentItemProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const replyButtonRef = useRef<HTMLButtonElement | null>(null);
  const [likes, setLikes] = useState(comment.likes || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [likeError, setLikeError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportError, setReportError] = useState('');
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
  // ALTCHA 人机验证：编辑/删除验证码都会触发邮件，各自独立一个闸门。
  const editCaptcha = useAltchaGate();
  const deleteCaptcha = useAltchaGate();
  const [isSendingDeleteCode, setIsSendingDeleteCode] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isOwner = false; // TODO: 通过 PocketBase 认证判断是否为评论作者
  const isDeleted = comment.deleted;
  const isEdited = comment.edited;

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

  const canReply = depth < maxDepth;

  // SSR 安全：仅在浏览器端水合后读取登录态（点赞必须登录，见 2026-10-14 加固）
  useEffect(() => {
    try {
      const pb = getPocketBase();
      setIsAuthenticated(Boolean(pb?.authStore?.isValid && pb.authStore.record));
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  /** 点赞 / 取消点赞（需登录；计数为服务端权威值） */
  const handleLike = async () => {
    if (isLiking || isDeleted) return;
    if (!isAuthenticated) {
      setLikeError('请先登录后再点赞');
      return;
    }
    const nextLiked = !isLiked;
    setIsLiking(true);
    try {
      const result = nextLiked
        ? await commentService.likeComment(comment.id)
        : await commentService.unlikeComment(comment.id);
      if (typeof result?.likes === 'number') setLikes(result.likes);
      setIsLiked(nextLiked);
      setLikeError('');
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setIsAuthenticated(false);
        setLikeError('请先登录后再点赞');
      } else if (isRateLimitedError(err)) {
        setLikeError('操作过于频繁，请稍后再试');
      } else {
        console.error('点赞失败:', err);
        setLikeError('点赞失败，请稍后再试');
      }
    } finally {
      setIsLiking(false);
    }
  };

  /** 举报 */
  const handleReport = async () => {
    if (!reportReason.trim() || isReporting) return;
    setIsReporting(true);
    setReportError('');
    try {
      await commentService.reportComment(comment.id, reportReason.trim());
      setReportSubmitted(true);
      setShowReportForm(false);
      setReportReason('');
    } catch (err) {
      console.error('举报失败:', err);
      setReportError('举报提交失败，请稍后再试');
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
    if (editCaptcha.blocked) {
      setEditError('请先完成人机验证后再提交');
      return;
    }
    setIsSendingCode(true);
    setEditError('');
    try {
      await commentService.sendVerificationCode(editEmail.trim(), editCaptcha.payload ?? undefined);
      setCodeSent(true);
    } catch (err) {
      console.error('发送验证码失败:', err);
      if (isCaptchaError(err)) {
        setEditError(captchaErrorMessage(err) ?? '人机验证未通过，请重试');
        editCaptcha.reset();
      } else {
        setEditError('发送验证码失败，请稍后重试');
      }
    } finally {
      setIsSendingCode(false);
    }
  };

  /** 发送删除验证码 */
  const handleSendDeleteCode = async () => {
    if (!deleteEmail.trim() || isSendingDeleteCode) return;
    if (deleteCaptcha.blocked) {
      setDeleteError('请先完成人机验证后再提交');
      return;
    }
    setIsSendingDeleteCode(true);
    setDeleteError('');
    try {
      await commentService.sendVerificationCode(deleteEmail.trim(), deleteCaptcha.payload ?? undefined);
      setDeleteCodeSent(true);
    } catch (err) {
      console.error('发送验证码失败:', err);
      if (isCaptchaError(err)) {
        setDeleteError(captchaErrorMessage(err) ?? '人机验证未通过，请重试');
        deleteCaptcha.reset();
      } else {
        setDeleteError('发送验证码失败，请稍后重试');
      }
    } finally {
      setIsSendingDeleteCode(false);
    }
  };

  // 已删除的评论不显示
  if (isDeleted) {
    return null;
  }

  return (
    <motion.article variants={itemVariants} initial="hidden" animate="visible" className="relative">
      <div
        className={cn(
          'relative overflow-hidden rounded-[3px] border bg-[var(--sf-surface)] p-4 transition-colors duration-300 sm:p-5',
          isNew ? 'border-[var(--sf-accent)]' : 'border-[var(--sf-line)]'
        )}
      >
        <div className="relative z-10">
          {/* 头部：头像 + 作者 + 时间 */}
          <div className="mb-3 flex min-w-0 items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[var(--sf-line)] font-mono text-xs font-semibold uppercase text-[var(--sf-ink-2)]"
              aria-hidden="true"
            >
              {getAvatarLetter(comment.author_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words font-medium text-[var(--sf-ink)]">{comment.author_name}</p>
                {comment.is_ai && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-[2px] border border-[var(--sf-line)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--sf-accent-ink)]"
                    title="该回复由 AI 生成"
                  >
                    AI
                  </span>
                )}
                {comment.author_level && <LevelBadge level={comment.author_level} size="sm" />}
                {isNew && (
                  <span className="inline-flex shrink-0 items-center rounded-[2px] border border-[var(--sf-accent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--sf-accent-ink)]">
                    NEW
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--sf-ink-3)]">
                <time dateTime={comment.created}>{formatTime(comment.created)}</time>
              </p>
            </div>
          </div>

          {/* 评论内容 */}
          <div className="mb-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">
            {sanitizeText(comment.content)}
            {isEdited && (
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--sf-ink-3)]" title={comment.edited_at ? `编辑于 ${new Date(comment.edited_at).toLocaleString('zh-CN')}` : '已编辑'}>
                （已编辑）
              </span>
            )}
          </div>

          {/* 操作栏 */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* 点赞（需登录；服务端按用户 id 去重） */}
            <button
              type="button"
              onClick={handleLike}
              disabled={isLiking}
              className={cn(
                'focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[2px] border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors sm:min-h-9 sm:min-w-0',
                isLiked
                  ? 'border-[var(--sf-accent)] text-[var(--sf-accent-ink)]'
                  : 'border-transparent text-[var(--sf-ink-3)] hover:border-[var(--sf-line)] hover:text-[var(--sf-ink-2)]'
              )}
              aria-label={isLiked ? '取消点赞' : '点赞'}
              aria-pressed={isLiked}
              title={!isAuthenticated ? '请先登录后再点赞' : undefined}
            >
              <svg className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {likes > 0 && <span>{likes}</span>}
            </button>

            {likeError && (
              <span role="alert" className="text-xs text-[var(--sf-danger)]">
                {likeError}
              </span>
            )}

            {/* 回复 */}
            {canReply && (
              <button
                ref={replyButtonRef}
                onClick={() => setIsReplyOpen(!isReplyOpen)}
                aria-expanded={isReplyOpen}
                aria-controls={`reply-form-${comment.id}`}
                className={actionButtonClass}
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
                className={actionButtonClass}
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
                className={actionButtonClass}
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
                className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[2px] border border-transparent px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-danger)] transition-colors hover:border-[var(--sf-line)] sm:min-h-9 sm:min-w-0"
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
          triggerRef={replyButtonRef}
        />

        {/* 举报表单 */}
        {showReportForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3"
          >
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="请说明举报原因..."
              rows={2}
              maxLength={500}
              className={inputClass}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={handleReport}
                disabled={!reportReason.trim() || isReporting}
                className="focus-ring inline-flex min-h-9 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-danger)] transition-colors hover:border-[var(--sf-line-strong)] disabled:opacity-50"
              >
                {isReporting ? '提交中...' : '提交举报'}
              </button>
              <button
                onClick={() => setShowReportForm(false)}
                className={secondarySmallButtonClass}
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
            role="status"
            className="mt-2 text-xs text-emerald-600 dark:text-emerald-400"
          >
            举报已提交，感谢反馈
          </motion.p>
        )}

        {/* 举报失败提示：就近可读，不再只留在控制台 */}
        {reportError && (
          <p role="alert" className="mt-2 text-xs text-[var(--sf-danger)]">
            {reportError}
          </p>
        )}

        {/* 编辑表单 */}
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3"
          >
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              maxLength={2000}
              className={inputClass}
            />
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="你的邮箱"
                  className={cn(inputClass, 'min-w-0 flex-1')}
                />
                <button
                  onClick={handleSendEditCode}
                  disabled={!editEmail.trim() || isSendingCode || codeSent || editCaptcha.blocked}
                  className={secondarySmallButtonClass}
                >
                  {isSendingCode ? '发送中...' : codeSent ? '已发送' : '发送验证码'}
                </button>
              </div>
              <AltchaField
                ref={editCaptcha.ref}
                id="comment-edit-altcha"
                onVerified={editCaptcha.onVerified}
                onStatusChange={editCaptcha.onStatusChange}
              />
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="6 位验证码"
                maxLength={6}
                className={inputClass}
              />
              {editError && <p role="alert" className="text-xs text-[var(--sf-danger)]">{editError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleEdit}
                  disabled={!editContent.trim() || !verificationCode.trim() || isSaving}
                  className="focus-ring inline-flex min-h-9 items-center justify-center rounded-[2px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-on-accent)] transition-colors hover:bg-[var(--sf-accent-ink)] disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditContent(comment.content); setEditEmail(''); setVerificationCode(''); setCodeSent(false); setEditError(''); }}
                  className={secondarySmallButtonClass}
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
            className="mt-3 rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3"
          >
            <p className="text-sm text-[var(--sf-danger)]">确定删除这条评论吗？此操作不可撤销。</p>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={deleteEmail}
                  onChange={(e) => setDeleteEmail(e.target.value)}
                  placeholder="你的邮箱"
                  className={cn(inputClass, 'min-w-0 flex-1')}
                />
                <button
                  onClick={handleSendDeleteCode}
                  disabled={!deleteEmail.trim() || isSendingDeleteCode || deleteCodeSent || deleteCaptcha.blocked}
                  className={secondarySmallButtonClass}
                >
                  {isSendingDeleteCode ? '发送中...' : deleteCodeSent ? '已发送' : '发送验证码'}
                </button>
              </div>
              <AltchaField
                ref={deleteCaptcha.ref}
                id="comment-delete-altcha"
                onVerified={deleteCaptcha.onVerified}
                onStatusChange={deleteCaptcha.onStatusChange}
              />
              <input
                type="text"
                value={deleteVerificationCode}
                onChange={(e) => setDeleteVerificationCode(e.target.value)}
                placeholder="6 位验证码"
                maxLength={6}
                className={inputClass}
              />
              {deleteError && <p role="alert" className="text-xs text-[var(--sf-danger)]">{deleteError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleDelete}
                  disabled={!deleteVerificationCode.trim() || isDeleting}
                  className="focus-ring inline-flex min-h-9 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--sf-danger)] transition-colors hover:border-[var(--sf-line-strong)] disabled:opacity-50"
                >
                  {isDeleting ? '删除中...' : '确认删除'}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteEmail(''); setDeleteVerificationCode(''); setDeleteCodeSent(false); setDeleteError(''); }}
                  className={secondarySmallButtonClass}
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 子评论（递归渲染） - 细线竖线引导嵌套关系 */}
      {comment.children.length > 0 && (
        <div className="mt-3 space-y-3 border-l border-[var(--sf-line)] pl-3 sm:pl-6">
          {comment.children.map((child) => (
            <CommentItem
              key={child.id}
              comment={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              onSubmitReply={onSubmitReply}
              isNew={newCommentIds?.has(child.id) ?? false}
              newCommentIds={newCommentIds}
              moderationEnabled={moderationEnabled}
              serverError={serverError}
              currentUserEmail={currentUserEmail}
            />
          ))}
        </div>
      )}
    </motion.article>
  );
}
