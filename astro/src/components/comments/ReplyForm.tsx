import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import Button from '../ui/Button';
import LoginRequiredNotice from './LoginRequiredNotice';
import { RateLimiter } from '../../lib/security';
import { authService } from '../../lib/services/authService';
import type { CommentFormData } from '../../types/pocketbase';
import type { CommentSubmitHandler } from '../../hooks/useComments';

const replyLimiter = new RateLimiter(3, 1/12);

const NAME_MAX = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTENT_MAX = 500;

interface ReplyFormProps {
  /** 是否显示回复框 */
  isOpen: boolean;
  /** 关闭回复框回调 */
  onClose: () => void;
  /**
   * 提交回调。推荐返回 { success, error }：失败文案随本次结果返回；
   * 旧的 boolean 返回值仍兼容（回退到 serverError prop / 通用兜底）。
   */
  onSubmit: CommentSubmitHandler;
  /** 父评论 ID */
  parentId?: string | null;
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
  /** 服务端返回的提交错误文案（来自 useComments.submitError），无文案时为 null */
  serverError?: string | null;
  /** 打开回复框的触发按钮：关闭后把焦点还给它 */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * 共享 textarea 样式 - 表面色 + 冷灰控制线 + 小圆角；
 * 聚焦时换成唯一强调色，颜色全部来自 --sf-* 令牌。
 */
const textareaClass =
  'w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2.5 text-sm text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)] transition-colors duration-200 ease-out outline-none focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]';

interface FieldErrors {
  content?: string;
  /** 既有契约保留：登录态下昵称来自账号，仍保留越界提示 */
  author_name?: string;
  author_email?: string;
}

/**
 * 回复表单组件
 *
 * 设计决策：
 * 1. 打开后焦点直接进入回复内容框，Esc/取消可收起——键盘用户不必再绕到取消按钮；
 *    关闭时把焦点还给回复按钮，并把 status 重置为 idle，再次打开不残留旧错误。
 * 2. 提交结果写入常驻 sr-only live region（只播报提交中/成功）；失败文案交给
 *    内联 `role="alert"` 播报一次，避免 polite + alert 双播报。
 * 3. 外层容器始终带着 `reply-form-{parentId}` id，让回复按钮的 aria-controls
 *    在任何展开状态下都指向真实存在的节点；内容框 id 按 parentId 隔离，
 *    多个回复框同时打开时不会出现重复 label id。
 * 5. 未登录不再渲染任何输入控件：整块换成「登录后可回复」+ /login 入口，
 *    昵称/邮箱改为只读的账号身份展示（后端规则要求必须登录才能回复）。
 * 4. 自动收起计时器随卸载清理，避免离开页面后 setState 警告。
 */
export default function ReplyForm({ isOpen, onClose, onSubmit, parentId = null, moderationEnabled = true, serverError, triggerRef }: ReplyFormProps) {
  // SSR 期（window === undefined）getPocketBase() 每次创建新实例且 authStore 为空，
  // 此时 getCurrentUser() 恒为 null。必须在浏览器端水合后通过 useEffect 同步登录态，
  // 避免 SSR/水合不匹配（hydration mismatch）。
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: parentId,
  });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const authedUserRef = useRef(false);

  useEffect(() => {
    const syncAuth = () => {
      const user = authService.isAuthenticated() ? authService.getCurrentUser() : null;
      if (user) {
        authedUserRef.current = true;
        // 昵称缺失时用邮箱前缀兜底：payload 必须带可读的 author_name
        const displayName =
          (user.name || '').trim() || (user.email ? user.email.split('@')[0] : '') || '读者';
        setFormData((prev) => ({
          ...prev,
          author_name: displayName,
          author_email: user.email || '',
        }));
        setIsLoggedIn(true);
      } else {
        // 登出或 token 失效：清掉自动填充的账号信息，避免残留在游客表单里
        if (authedUserRef.current) {
          authedUserRef.current = false;
          setFormData((prev) => ({ ...prev, author_name: '', author_email: '' }));
        }
        setIsLoggedIn(false);
      }
    };
    syncAuth();
    const unsub = authService.onAuthChange(syncAuth);
    return () => { unsub?.(); };
  }, []);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [liveMessage, setLiveMessage] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);
  // 每次提交/关闭递增；关闭后才返回的提交结果不能写进下一次展开的表单
  const submitAttemptRef = useRef(0);

  const panelId = `reply-form-${parentId ?? 'new'}`;
  const contentId = `reply-content-${parentId ?? 'new'}`;
  const errorId = `reply-error-${parentId ?? 'new'}`;
  /** 关闭/收起时回到干净状态：再次展开不能残留上一次的 error/success。 */
  const resetStatus = useCallback(() => {
    setStatus('idle');
    setErrorMessage('');
    setAuthRequired(false);
    setFieldErrors({});
    setLiveMessage('');
  }, []);

  // 打开时把焦点交给内容框；只在「关闭 → 打开」的边沿触发，避免动画重渲染抢焦点。
  // 依赖 isLoggedIn：首帧按未登录渲染占位面板，登录态同步后内容框才挂载，
  // 不重新触发这个 effect 的话焦点会永远停在「去登录」按钮上。
  useEffect(() => {
    if (isOpen && isLoggedIn && !wasOpenRef.current) {
      wasOpenRef.current = true;
      contentRef.current?.focus({ preventScroll: true });
    } else if (!isOpen) {
      // 父组件直接收起（例如再次点回复按钮）时也重置，避免旧状态粘到下一次展开；
      // 同时作废进行中的提交，迟到的结果不得写回下一次展开的表单。
      if (wasOpenRef.current) {
        submitAttemptRef.current += 1;
        resetStatus();
      }
      wasOpenRef.current = false;
    }
  }, [isOpen, isLoggedIn, resetStatus]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const fail = (message: string) => {
    setStatus('error');
    setErrorMessage(message);
    // 错误由内联 role="alert" 播报；清空 polite 区避免重复
    setLiveMessage('');
  };

  /**
   * 关闭时先清掉自动收起计时器，把焦点还给回复按钮，并重置状态。
   * `aria-expanded` 由父组件控制；这里只负责表单自身的收尾。
   */
  const handleClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    // 作废进行中的提交：取消后迟到的结果不应再写入状态
    submitAttemptRef.current += 1;
    resetStatus();
    onClose();
    triggerRef?.current?.focus({ preventScroll: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    // 未登录不应有提交入口；兜底防止误回归时发出请求
    if (!isLoggedIn) {
      setAuthRequired(true);
      fail('请先登录后再回复');
      return;
    }
    setAuthRequired(false);

    // 既有契约：缺失昵称或内容时给同一条提示（登录态下昵称来自账号，实际只剩内容校验）
    if (!formData.author_name || !formData.content) {
      setFieldErrors({
        author_name: formData.author_name ? undefined : '请填写昵称',
        content: formData.content ? undefined : '请填写回复内容',
      });
      // 既有无障碍契约文案：'请填写昵称和回复内容'
      fail('请填写回复内容');
      return;
    }

    // 邮箱可选：仅在填写时校验格式（既有契约，登录态下邮箱来自账号）
    if (formData.author_email && !EMAIL_RE.test(formData.author_email)) {
      setFieldErrors({ author_email: '邮箱格式不正确' });
      fail('邮箱格式不正确');
      return;
    }

    if (formData.author_name.length > NAME_MAX || formData.content.length > CONTENT_MAX) {
      setFieldErrors({
        author_name: formData.author_name.length > NAME_MAX ? `昵称不超过 ${NAME_MAX} 字` : undefined,
        content: formData.content.length > CONTENT_MAX ? `回复不超过 ${CONTENT_MAX} 字` : undefined,
      });
      fail(formData.author_name.length > NAME_MAX ? `昵称不超过 ${NAME_MAX} 字` : `回复不超过 ${CONTENT_MAX} 字`);
      return;
    }

    if (!replyLimiter.tryConsume()) {
      fail('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    setLiveMessage('正在提交回复…');
    const attempt = ++submitAttemptRef.current;
    // 身份信息一律取账号（已登录，已在上方长度校验中限制），不接受用户输入
    const result = await onSubmit({ ...formData, parent_id: parentId });
    // 关闭/取消后才返回的结果直接丢弃，不能污染下一次展开的表单
    if (attempt !== submitAttemptRef.current) return;
    // 兼容旧式 boolean 回调；新式结果里的 error 是**本次**失败文案
    const success = typeof result === 'boolean' ? result : result.success;

    if (success) {
      setStatus('success');
      setFieldErrors({});
      setLiveMessage(moderationEnabled ? '回复已提交，审核后展示' : '回复已提交');
      // 身份来自账号，只需清空内容
      setFormData((prev) => ({ ...prev, content: '', parent_id: parentId }));
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        resetStatus();
        closeTimerRef.current = null;
        onClose();
        triggerRef?.current?.focus({ preventScroll: true });
      }, 1500);
    } else {
      // 新式结果优先用本次返回的 error；旧式 boolean 才回退到 serverError prop。
      const failureCopy =
        typeof result === 'boolean'
          ? serverError || '提交失败，请重试'
          : result.error || '提交失败，请重试';
      const requiresLogin = typeof result === 'boolean' ? false : Boolean(result.authRequired);
      if (requiresLogin) {
        setAuthRequired(true);
        fail('请先登录后再回复');
      } else {
        fail(failureCopy);
      }
    }
  };

  /** height:auto 平滑展开收起 */
  const formVariants: Variants = {
    hidden: { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.25, ease: 'easeInOut' } },
    visible: {
      opacity: 1,
      height: 'auto',
      marginTop: 16,
      transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
    },
    exit: { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.25, ease: 'easeInOut' } },
  };

  const successVariants: Variants = {
    hidden: { scale: 0.96, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { type: 'spring' as const, stiffness: 400, damping: 24 },
    },
  };

  return (
    <div id={panelId}>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="overflow-hidden"
          >
            {/* 常驻播报区：成功态替换表单后依然存在 */}
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {liveMessage}
            </p>

            {/* 未登录：不渲染输入控件，直接给登录入口（后端要求必须登录才能回复） */}
            {!isLoggedIn ? (
              <LoginRequiredNotice
                title="登录后可回复"
                description="回复需要登录账号；登录后会自动使用你的昵称与邮箱，无需重复填写。"
              />
            ) : (
            <form
              onSubmit={handleSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  handleClose();
                }
              }}
              className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 sm:p-5"
              aria-busy={status === 'loading'}
              noValidate
            >
              {status === 'success' ? (
                /* ==================== 成功状态 ==================== */
                <motion.div
                  variants={successVariants}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-col items-center gap-2 py-4"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-emerald-600 dark:text-emerald-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">
                    {moderationEnabled ? '回复已提交，审核后展示' : '回复已提交'}
                  </p>
                </motion.div>
              ) : (
                /* ==================== 表单状态 ==================== */
                <div className="space-y-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">Reply / 03</p>

                  {/* 身份只读展示：昵称/邮箱来自登录账号 */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">Identity</span>
                    <span className="break-words text-sm font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                      {formData.author_name}
                    </span>
                    {formData.author_email && (
                      <span className="break-all font-mono text-[11px] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">
                        {formData.author_email}
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor={contentId} className="mb-1.5 block text-sm font-medium text-[var(--sf-ink-2)]">
                      回复内容
                    </label>
                    <textarea
                      ref={contentRef}
                      id={contentId}
                      value={formData.content}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, content: e.target.value }));
                        if (status === 'error') {
                          setStatus('idle');
                          setFieldErrors((prev) => ({ ...prev, content: undefined }));
                        }
                      }}
                      placeholder="写下你的回复..."
                      rows={3}
                      maxLength={CONTENT_MAX}
                      className={textareaClass}
                      aria-invalid={status === 'error' && Boolean(fieldErrors.content)}
                      aria-describedby={status === 'error' ? errorId : undefined}
                      required
                    />
                  </div>

                  {status === 'error' && (
                    <motion.div
                      id={errorId}
                      role="alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-[var(--sf-danger)]"
                    >
                      <span className="flex items-center gap-1.5">
                        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        {errorMessage}
                      </span>
                      {authRequired && (
                        <a
                          href="/login"
                          className="focus-ring inline-flex min-h-9 items-center rounded-[3px] border border-[var(--sf-line-control)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] no-underline transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
                        >
                          去登录
                        </a>
                      )}
                    </motion.div>
                  )}

                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="ghost" size="sm" onClick={handleClose} type="button">
                      取消
                    </Button>
                    <Button variant="primary" size="sm" type="submit" loading={status === 'loading'}>
                      发送回复
                    </Button>
                  </div>
                </div>
              )}
            </form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
