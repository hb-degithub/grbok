import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '../../hooks/domains/useUser';
import { RateLimiter } from '../../lib/security';
import { isShowcasePathname } from '../../lib/showcase-path';
import useBreakpoint from '../../hooks/useBreakpoint';

/**
 * 展示页首次访问引导（首页专用）。
 *
 * 与旧实现相比只改「视觉 / 出现场景 / 焦点与键盘体验」，认证流程保持原样：
 * - 仍然通过 `useUser()` 的 `registerReader` / `requestVerification` 发起真实请求；
 * - 仍然用模块级 `RateLimiter(5, 0.2)` 做提交频率保护，不绕过、不放宽；
 * - 仍然以 `blog-welcomed` 作为「已看过」标记。
 *
 * 新增约束：
 * - 只在展示页出现（与 BaseLayout 共用 `isShowcasePathname()`，只认规范首页 `/`）；
 *   其它页面不渲染，也绝不阻断正文（BaseLayout 只在该页挂载 + 组件内 pathname 守卫双重保证）；
 * - 改成单面板轻场景，不再叠加 Stepper / SplitText / SpotlightCard 等多层动画；
 * - 打开时把焦点移入 dialog，Tab 在内部循环，Esc 关闭，关闭后把焦点归还给打开前的元素。
 *
 * 这里不是另一个认证入口：注册成功后的验证步骤、限流与失败提示都属于同一条既有流程。
 */

const STORAGE_KEY = 'blog-welcomed';
/** 重发成功后的按钮复位时间（与旧实现一致的 5s，避免一直停在「已重新发送」）。 */
const RESEND_RESET_MS = 5000;

/** 单次注册的提交频率保护（与旧实现一致的 5 次 / 0.2 token/s）。 */
const registerLimiter = new RateLimiter(5, 0.2);

/** 焦点循环的候选元素；`:not([tabindex="-1"])` 排除 dialog 容器本身。 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 展示页判定与 BaseLayout 共用 `isShowcasePathname()`，避免两边各写一套。 */
function isShowcasePath(): boolean {
  return isShowcasePathname(window.location.pathname);
}

function hasBeenWelcomed(): boolean {
  try {
    return !!window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function markWelcomed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, Date.now().toString());
  } catch {
    /* ignore */
  }
}

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
  );
}

/** 简单邮箱格式校验；邮箱本身可选，只在填写时校验。 */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function WelcomeOverlay() {
  const [visible, setVisible] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regStatus, setRegStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [regError, setRegError] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent'>('idle');

  const { registerReader, requestVerification, isLoggedIn: checkLoggedIn } = useUser();
  const { isMobile, prefersReducedMotion } = useBreakpoint();

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const resendResetTimer = useRef<number | null>(null);

  /* 卸载时清掉重发复位定时器，避免在已卸载组件上 setState。 */
  useEffect(
    () => () => {
      if (resendResetTimer.current !== null) {
        window.clearTimeout(resendResetTimer.current);
        resendResetTimer.current = null;
      }
    },
    [],
  );

  /* 出现场景：只在展示页、且本机尚未看过引导时出现。 */
  useEffect(() => {
    if (!isShowcasePath() || hasBeenWelcomed()) return;
    setIsLoggedIn(checkLoggedIn());
    setVisible(true);
  }, [checkLoggedIn]);

  /* 打开期间锁定背景滚动；关闭时把焦点归还给打开前的元素。 */
  useEffect(() => {
    if (!visible) return;

    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 等 dialog 完成首次绘制后再移入焦点，避免焦点落到即将被替换的节点上。
    const timer = window.setTimeout(() => {
      const [first] = getFocusable(dialogRef.current);
      (first ?? dialogRef.current)?.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousActiveElement.current?.focus?.({ preventScroll: true });
    };
  }, [visible]);

  const dismiss = useCallback(() => {
    if (regStatus === 'loading') return; // 提交中禁止关闭
    markWelcomed();
    setVisible(false);
  }, [regStatus]);

  /*
   * 注册成功后表单被成功面板替换，原先聚焦的提交按钮会随表单卸载，
   * 浏览器的默认行为会把焦点丢给 <body>（屏幕阅读器与键盘用户失去位置）。
   * 这里主动把焦点移到成功面板标题（tabIndex=-1），保证焦点留在 dialog 内。
   */
  useEffect(() => {
    if (regStatus !== 'success') return;
    successHeadingRef.current?.focus({ preventScroll: true });
  }, [regStatus]);

  /* Esc 关闭 + Tab 焦点循环（焦点若跑到 dialog 外，拉回第一个）。 */
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length === 0) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (!active || !root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, dismiss]);

  const handleBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) dismiss();
    },
    [dismiss],
  );

  const handleRegister = useCallback(async () => {
    const trimmedName = regName.trim();
    const trimmedEmail = regEmail.trim();

    if (!trimmedName || !regPassword) {
      setRegStatus('error');
      setRegError('请填写昵称和密码');
      return;
    }
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      setRegStatus('error');
      setRegError('邮箱格式不正确');
      return;
    }
    if (regPassword.length < 8) {
      setRegStatus('error');
      setRegError('密码至少需要 8 个字符');
      return;
    }
    if (!registerLimiter.tryConsume()) {
      setRegStatus('error');
      setRegError('操作过于频繁，请稍后再试');
      return;
    }

    setRegStatus('loading');
    setRegError('');

    // 不论成功失败都立刻清空明文密码 state，避免驻留。
    const passwordToSubmit = regPassword;
    setRegPassword('');

    const { success } = await registerReader({
      email: trimmedEmail || undefined,
      name: trimmedName,
      password: passwordToSubmit,
      passwordConfirm: passwordToSubmit,
    });

    if (success) {
      setRegisteredEmail(trimmedEmail);
      setRegStatus('success');
    } else {
      setRegStatus('error');
      setRegError('提交失败，请检查信息后重试');
    }
  }, [regName, regEmail, regPassword, registerReader]);

  const handleResendVerification = useCallback(async () => {
    if (!registeredEmail) return;
    if (resendResetTimer.current !== null) {
      window.clearTimeout(resendResetTimer.current);
      resendResetTimer.current = null;
    }
    setResendStatus('loading');
    const { success } = await requestVerification(registeredEmail);
    setResendStatus(success ? 'sent' : 'idle');
    if (success) {
      // 恢复旧行为：5s 后复位，允许再次请求；期间按钮保持禁用。
      resendResetTimer.current = window.setTimeout(() => {
        resendResetTimer.current = null;
        setResendStatus('idle');
      }, RESEND_RESET_MS);
    }
  }, [registeredEmail, requestVerification]);

  if (!visible) return null;

  const reduced = prefersReducedMotion;
  const panelMaxHeight = isMobile ? 'max-h-[calc(100dvh-1.5rem)]' : 'max-h-[calc(100dvh-3rem)]';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[var(--sf-scrim)] px-3 py-3 sm:px-4"
      onClick={handleBackdropClick}
      role="presentation"
      data-welcome-overlay="true"
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="欢迎引导"
        tabIndex={-1}
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={`relative w-full max-w-lg overflow-y-auto rounded-[3px] border border-[var(--sf-line-strong)] bg-[var(--sf-canvas)] outline-none ${panelMaxHeight}`}
      >
        {/* 顶部：日志式标头 + 关闭按钮（第一个可聚焦元素）。 */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--sf-line)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">
              FIRST VISIT / 首次访问
            </p>
            <h2 className="mt-1.5 text-lg font-semibold leading-tight tracking-tight text-[var(--sf-ink)] sm:text-xl">
              欢迎来到胡巴的博客
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[var(--sf-line-control)] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
            aria-label="关闭欢迎引导"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <p className="text-sm leading-relaxed text-[var(--sf-ink-2)]">
            一个关于技术、思考与生活的个人空间。注册后可以参与评论互动，也可以先随便看看。
          </p>

          {/* 功能说明保持轻量：纯文本行，不再叠 SpotlightCard / SplitText。 */}
          <ul className="mt-3 grid gap-1.5 border-y border-[var(--sf-line-soft)] py-3">
            {[
              '技术文章：前端、后端与开发实践',
              '评论互动：与作者和其他读者交流',
              '全文搜索：快速找到感兴趣的内容',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 font-mono text-[11px] leading-relaxed text-[var(--sf-ink-2)]">
                <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 bg-[var(--sf-accent)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {isLoggedIn ? (
            <p className="mt-4 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-[var(--sf-ink-3)]">
              已登录 · 可以直接开始浏览，或前往账户页管理资料。
            </p>
          ) : regStatus === 'success' ? (
            /*
             * 注册成功分支：只有填写了邮箱才进入「验证邮件」流程。
             * 未填写邮箱时注册请求本身不会带 email，也就不会发送验证邮件——
             * 此时既不能显示「验证邮件已发送至」，也不能留一个点了没反应的重发按钮。
             */
            <div className="mt-4 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3">
              <h3
                ref={successHeadingRef}
                tabIndex={-1}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--sf-ink-3)] outline-none"
              >
                {registeredEmail ? '验证邮箱' : '注册成功'}
              </h3>
              {/*
               * scripts/check-auth-facade-cutover.ps1 要求无邮箱分支的肯定文案只出现在
               * 这个三元表达式里，并与中性提示写在同一行：注册门面
               * (pb_hooks/lib/registration_facade.js:97) 对重复邮箱同样返回
               * 202 REGISTRATION_SUBMITTED 且不发送邮件，因此有邮箱时只能给出中性的
               * 「提交后请验证邮箱」，不能断言邮件已经送达。
               */}
              <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--sf-ink)]">
                {registeredEmail ? '提交后请验证邮箱，验证完成后可评论' : '注册成功！'}
              </p>
              {registeredEmail ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--sf-ink-2)]">
                    验证邮件已发送至
                    <span className="mx-1 font-medium text-[var(--sf-ink)]">{registeredEmail}</span>
                    。点击邮件中的链接完成验证，之后即可发表评论。
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendStatus === 'loading' || resendStatus === 'sent'}
                    className="focus-ring mt-3 rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)] disabled:opacity-50"
                  >
                    {resendStatus === 'loading'
                      ? '发送中...'
                      : resendStatus === 'sent'
                        ? '已重新发送 ✓'
                        : '重新发送验证邮件'}
                  </button>
                  <p className="mt-2 text-xs text-[var(--sf-ink-3)]">也可以稍后再验证，不影响浏览。</p>
                </>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-[var(--sf-ink-2)]">
                  注册成功，可直接评论。本次未填写邮箱，因此不会收到验证邮件；之后可以在账户页补充邮箱并完成验证。
                </p>
              )}
            </div>
          ) : (
            /* 注册表单：字段名/标签与旧流程一致，只是换成单面板布局。 */
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRegister();
              }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
                创建读者账户（可选）
              </p>

              <div>
                <label htmlFor="welcome-name" className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
                  昵称
                </label>
                <input
                  id="welcome-name"
                  type="text"
                  value={regName}
                  onChange={(event) => {
                    setRegName(event.target.value);
                    if (regStatus === 'error') {
                      setRegStatus('idle');
                      setRegError('');
                    }
                  }}
                  placeholder="你的昵称"
                  autoComplete="name"
                  className="w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-sm text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-1 focus-visible:ring-[var(--sf-accent)]"
                />
              </div>

              <div>
                <label htmlFor="welcome-email" className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
                  邮箱（可选）
                </label>
                <input
                  id="welcome-email"
                  type="email"
                  value={regEmail}
                  onChange={(event) => {
                    setRegEmail(event.target.value);
                    if (regStatus === 'error') {
                      setRegStatus('idle');
                      setRegError('');
                    }
                  }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  className="w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-sm text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-1 focus-visible:ring-[var(--sf-accent)]"
                />
              </div>

              <div>
                <label htmlFor="welcome-password" className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">
                  密码
                </label>
                <input
                  id="welcome-password"
                  type="password"
                  value={regPassword}
                  onChange={(event) => {
                    setRegPassword(event.target.value);
                    if (regStatus === 'error') {
                      setRegStatus('idle');
                      setRegError('');
                    }
                  }}
                  placeholder="至少 8 个字符"
                  autoComplete="new-password"
                  className="w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-sm text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-1 focus-visible:ring-[var(--sf-accent)]"
                />
              </div>

              {regStatus === 'error' && regError && (
                <p className="border-l-2 border-[var(--sf-danger)] pl-2 font-mono text-[11px] tracking-[0.06em] text-[var(--sf-danger)]">
                  {regError}
                </p>
              )}

              <button
                type="submit"
                disabled={regStatus === 'loading'}
                className="focus-ring w-full rounded-[2px] bg-[var(--sf-accent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-on-accent)] transition-colors hover:bg-[var(--sf-accent-ink)] disabled:opacity-50"
              >
                {regStatus === 'loading' ? '提交中...' : '提交注册'}
              </button>

              <p className="text-center font-mono text-[11px] tracking-[0.06em] text-[var(--sf-ink-3)]">
                已有账户？
                <a
                  href="/login"
                  onClick={dismiss}
                  className="text-[var(--sf-accent-ink)] no-underline hover:underline"
                >
                  登录
                </a>
              </p>
            </form>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sf-line-soft)] pt-3">
            <p className="font-mono text-[10px] leading-relaxed tracking-[0.04em] text-[var(--sf-ink-3)]">
              注册即可浏览；验证只影响发表评论
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="focus-ring rounded-[2px] border border-[var(--sf-line-control)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
            >
              开始浏览
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
