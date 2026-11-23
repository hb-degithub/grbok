import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import Button from '../ui/Button';
import AltchaField from '../auth/AltchaField';
import LoginRequiredNotice from './LoginRequiredNotice';
import { useAltchaGate } from '../../hooks/useAltchaGate';
import { captchaErrorMessage } from '../../lib/captcha';
import { RateLimiter } from '../../lib/security';
import { authService } from '../../lib/services/authService';
import { requestVerification } from '../../lib/blog-auth-client';
import type { CommentFormData } from '../../types/pocketbase';
import type { CommentSubmitHandler } from '../../hooks/useComments';

const commentLimiter = new RateLimiter(3, 1/12); // 每分钟最多3条

const NAME_MAX = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTENT_MAX = 1000;
const ERROR_ID = 'comment-form-error';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

const successVariants: Variants = {
  hidden: { scale: 0.96, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 24 },
  },
};

interface CommentFormProps {
  /** 文章 ID */
  postId: string;
  /**
   * 提交回调。
   * 推荐返回 { success, error, authRequired }：失败文案随本次结果返回；
   * 旧的 boolean 返回值仍兼容（此时回退到 serverError prop / 通用兜底）。
   */
  onSubmit: CommentSubmitHandler;
  /** 是否启用人工审核 */
  moderationEnabled?: boolean;
  /** 当前登录用户是否已验证邮箱（undefined = 未登录 / 不强制） */
  userEmailVerified?: boolean;
  /** 服务端返回的提交错误文案（来自 useComments.submitError），无文案时为 null */
  serverError?: string | null;
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
 * 主评论表单组件
 *
 * 登录门禁（2026-11 改造）：后端评论规则改为「必须登录」后，
 * 前端不再渲染游客昵称/邮箱输入：
 * 1. 未登录 → 整块替换为「登录后可评论 + 去登录」，**不渲染 textarea、不触发任何提交**；
 * 2. 已登录 → 隐藏昵称/邮箱输入，只读展示「以 xxx 身份评论」，payload 用账号信息；
 * 3. 服务端仍返回 401/403（例如 token 在提交瞬间失效）→ 错误提示旁给出登录入口。
 *
 * 其余设计决策沿用旧版：
 * - 提交结果写进一个**常驻**的 sr-only live region（role=status + polite），
 *   失败文案交给就近的 `role="alert"` 播报一次，避免同一句错误念两遍；
 * - 失败文案优先取**本次** onSubmit 返回的 error，而不是 await 之前捕获的 serverError；
 * - textarea 不做 focus 缩放，保持像素稳定。
 */
export default function CommentForm({ postId, onSubmit, moderationEnabled = true, userEmailVerified, serverError }: CommentFormProps) {
  // SSR 期（window === undefined）getPocketBase() 每次创建新实例且 authStore 为空，
  // 此时 getCurrentUser() 恒为 null。必须在浏览器端水合后通过 useEffect 同步登录态，
  // 避免 SSR/水合不匹配（hydration mismatch）。
  const [formData, setFormData] = useState<CommentFormData>({
    author_name: '',
    author_email: '',
    content: '',
    parent_id: null,
  });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const authedUserRef = useRef(false);

  useEffect(() => {
    const syncAuth = () => {
      const user = authService.isAuthenticated() ? authService.getCurrentUser() : null;
      if (user) {
        authedUserRef.current = true;
        // 昵称缺失时用邮箱前缀兜底：后端要求 author_name 非空，
        // 展示也必须有可读的「以 xxx 身份评论」。
        const displayName =
          (user.name || '').trim() || (user.email ? user.email.split('@')[0] : '') || '读者';
        setFormData((prev) => ({
          ...prev,
          author_name: displayName,
          author_email: user.email || '',
        }));
        setIsLoggedIn(true);
      } else {
        // 登出或 token 失效：清掉账号信息，回到登录门禁
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
  const statusTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
  }, []);

  const fail = useCallback((message: string) => {
    setStatus('error');
    setErrorMessage(message);
    // 错误由内联 role="alert" 播报；清空 polite 区，避免同一句话被念两遍
    setLiveMessage('');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 兜底：未登录时即使触发了提交也不发请求（按钮本就不渲染，这里防止未来的误回归）
    if (!isLoggedIn) {
      setAuthRequired(true);
      fail('请先登录后再发表评论');
      return;
    }
    setFieldErrors({});
    setAuthRequired(false);

    // 既有契约：缺失昵称或内容时给同一条提示（登录态下昵称来自账号，实际只剩内容校验）
    if (!formData.author_name || !formData.content) {
      setFieldErrors({
        author_name: formData.author_name ? undefined : '请填写昵称',
        content: formData.content ? undefined : '请填写评论内容',
      });
      // 既有无障碍契约文案：'请填写昵称和评论内容'
      fail('请填写评论内容');
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
        content: formData.content.length > CONTENT_MAX ? `评论不超过 ${CONTENT_MAX} 字` : undefined,
      });
      fail(formData.author_name.length > NAME_MAX ? `昵称不超过 ${NAME_MAX} 字` : `评论不超过 ${CONTENT_MAX} 字`);
      return;
    }

    if (!commentLimiter.tryConsume()) {
      fail('操作太频繁，请稍后再试');
      return;
    }

    setStatus('loading');
    setLiveMessage('正在提交评论…');
    // 身份信息一律取账号（已登录，已在上方长度校验中限制），不接受用户输入
    const result = await onSubmit({ ...formData, parent_id: null });
    // 兼容旧式 boolean 回调；新式结果里的 error 是**本次**失败文案
    const success = typeof result === 'boolean' ? result : result.success;
    const requiresLogin = typeof result === 'boolean' ? false : Boolean(result.authRequired);

    if (success) {
      setStatus('success');
      setFieldErrors({});
      setLiveMessage(moderationEnabled ? '评论提交成功，审核后展示！' : '评论提交成功！');
      setFormData((prev) => ({ ...prev, content: '', parent_id: null }));
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => setStatus('idle'), 2000);
    } else {
      // 新式结果优先用本次返回的 error；旧式 boolean 才回退到 serverError prop。
      // 注意不能先读 serverError：它在 await 之前捕获，首次失败时仍是 null。
      const failureCopy =
        typeof result === 'boolean'
          ? serverError || '提交失败，请重试'
          : result.error || '提交失败，请重试';
      if (requiresLogin) {
        setAuthRequired(true);
        fail('请先登录后再发表评论');
      } else {
        fail(failureCopy);
      }
    }
  };

  const [verifyResendStatus, setVerifyResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [verifyResendMessage, setVerifyResendMessage] = useState('');
  // ALTCHA 人机验证：只拦截「重新发送验证邮件」这个会触发邮件的动作，
  // 评论区普通提交（onSubmit）不经过这里。
  const captcha = useAltchaGate();

  const handleResendVerification = useCallback(async () => {
    const email = authService.getUserEmail();
    if (!email) return;
    // 人机验证闸门：widget 明确未验证时不发邮件。
    if (captcha.blocked) {
      setVerifyResendStatus('idle');
      setVerifyResendMessage('请先完成人机验证后再提交');
      return;
    }
    setVerifyResendStatus('sending');
    setVerifyResendMessage('');
    try {
      await requestVerification(email, captcha.payload ?? undefined);
      // 邮件已发出：旧 challenge 已被服务端消费，重新取一个挑战。
      captcha.reset();
      setVerifyResendStatus('sent');
    } catch (err) {
      const captchaFailure = captchaErrorMessage(err);
      if (captchaFailure) {
        captcha.reset();
        setVerifyResendStatus('error');
        setVerifyResendMessage(captchaFailure);
        return;
      }
      setVerifyResendStatus('error');
      setVerifyResendMessage('发送失败，请稍后重试');
    }
  }, [captcha]);

  // Logged-in user with unverified email — show prompt instead of form
  if (userEmailVerified === false) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-7 text-center sm:p-8"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-[var(--sf-ink-3)]">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h4 className="text-base font-semibold text-[var(--sf-ink)]">请先验证邮箱</h4>
        <p className="text-sm text-[var(--sf-ink-3)]">验证邮箱后即可发表评论</p>
        {/* 发送验证邮件会触发邮件，走 ALTCHA 人机验证；未验证时禁用按钮。 */}
        <AltchaField
          ref={captcha.ref}
          id="comment-verify-altcha"
          onVerified={captcha.onVerified}
          onStatusChange={captcha.onStatusChange}
        />
        {verifyResendStatus === 'sent' ? (
          <p role="status" className="text-sm font-medium text-emerald-600 dark:text-emerald-400">验证邮件已发送，请检查收件箱</p>
        ) : (
          <>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={verifyResendStatus === 'sending' || captcha.blocked}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-[2px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50"
            >
              {verifyResendStatus === 'sending' ? '发送中...' : '重新发送验证邮件'}
            </button>
            {verifyResendStatus === 'error' && verifyResendMessage && (
              <p role="alert" className="text-sm text-[var(--sf-danger)]">{verifyResendMessage}</p>
            )}
          </>
        )}
      </motion.div>
    );
  }

  // 未登录：不渲染任何输入控件，也不可能有 onSubmit 调用
  if (!isLoggedIn) {
    return <LoginRequiredNotice />;
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:p-7"
    >
      {/* 常驻播报区：与可见状态解耦，成功态替换表单后依然存在 */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      <AnimatePresence mode="wait">
        {status === 'success' ? (
          /* ==================== 成功状态 ==================== */
          <motion.div
            key="success"
            variants={successVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="flex flex-col items-center gap-3 py-8"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-[2px] border border-[var(--sf-line)] text-emerald-600 dark:text-emerald-400">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-medium text-emerald-600 dark:text-emerald-400">
              {moderationEnabled ? '评论提交成功，审核后展示！' : '评论提交成功！'}
            </p>
          </motion.div>
        ) : (
          /* ==================== 表单状态 ==================== */
          <motion.form
            key="form"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onSubmit={handleSubmit}
            className="space-y-4"
            aria-busy={status === 'loading'}
            noValidate
          >
            <motion.div variants={itemVariants}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">Form / 02</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--sf-ink)]">发表评论</h3>
              <p className="mt-1 text-sm text-[var(--sf-ink-3)]">
                {`以 ${formData.author_name || formData.author_email} 的身份评论${moderationEnabled ? '，审核后展示' : ''}`}
              </p>
            </motion.div>

            {/* 身份只读展示：昵称/邮箱来自登录账号，不再让用户填写 */}
            <motion.div
              variants={itemVariants}
              data-testid="comment-identity"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-3 py-2"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)]">Identity</span>
              <span className="break-words text-sm font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">
                {formData.author_name}
              </span>
              {formData.author_email && (
                <span className="break-all font-mono text-[11px] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">
                  {formData.author_email}
                </span>
              )}
            </motion.div>

            <motion.div variants={itemVariants}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor="comment-content" className="block text-sm font-medium text-[var(--sf-ink-2)]">
                  评论内容
                </label>
                <span className="font-mono text-[11px] tabular-nums tracking-[0.04em] text-[var(--sf-ink-3)]">
                  {formData.content.length} / {CONTENT_MAX}
                </span>
              </div>
              <textarea
                id="comment-content"
                value={formData.content}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, content: e.target.value }));
                  if (status === 'error') {
                    setStatus('idle');
                    setFieldErrors((prev) => ({ ...prev, content: undefined }));
                  }
                }}
                placeholder="写下你的想法..."
                rows={4}
                maxLength={CONTENT_MAX}
                className={textareaClass}
                aria-invalid={status === 'error' && Boolean(fieldErrors.content)}
                aria-describedby={status === 'error' ? ERROR_ID : undefined}
                required
              />
            </motion.div>

            {/* 错误提示 */}
            {status === 'error' && (
              <motion.div
                id={ERROR_ID}
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

            <motion.div variants={itemVariants}>
              <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} className="w-full sm:w-auto">
                发表评论
              </Button>
            </motion.div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
