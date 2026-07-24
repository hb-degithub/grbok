import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Stepper, { Step } from '../reactbits/Stepper';
import SplitText from '../reactbits/SplitText';
import SpotlightCard from '../reactbits/SpotlightCard';
import { usePocketBase } from '../../hooks/usePocketBase';
import { getPocketBase } from '../../lib/pocketbase';
import { RateLimiter } from '../../lib/security';
import useBreakpoint from '../../hooks/useBreakpoint';

const STORAGE_KEY = 'blog-welcomed';

const registerLimiter = new RateLimiter(5, 0.2);

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
  } catch { /* ignore */ }
}

export default function WelcomeOverlay() {
  const [visible, setVisible] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regStatus, setRegStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [regError, setRegError] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const { registerReader, requestVerification } = usePocketBase();
  const { isMobile } = useBreakpoint();
  const spotlightSize = isMobile ? 120 : 180;
  const [isLandscapePhone, setIsLandscapePhone] = useState(false);

  // Imperative handle into the Stepper so we can advance it after async
  // registration succeeds — the registration step has no footer "next" button,
  // so the only way forward is a successful register (auto-advances) or the
  // explicit "skip registration" confirmation.
  const stepperRef = useRef(null);

  // Track all pending timeouts so they can be cancelled on unmount — otherwise
  // they fire setState on a torn-down component (dev-mode warning, stepper
  // advance on an unmounted Stepper).
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  // Step 4 is the registration step (only present for logged-out users).
  // The email-verification step that follows only renders after regStatus ===
  // 'success', so the registration step number stays 4 regardless.
  const registrationStepNumber = 4;

  useEffect(() => {
    const checkLandscape = () => {
      setIsLandscapePhone(isMobile && window.innerHeight < 520);
    };
    checkLandscape();
    window.addEventListener('resize', checkLandscape, { passive: true });
    return () => window.removeEventListener('resize', checkLandscape);
  }, [isMobile]);

  useEffect(() => {
    // Never show the welcome guide on auth/admin pages - it would block login.
    const path = window.location.pathname;
    const skipOverlay = path.startsWith('/login') || path.startsWith('/admin');
    if (!hasBeenWelcomed() && !skipOverlay) {
      const pb = getPocketBase();
      setIsLoggedIn(pb.authStore.isValid && !!pb.authStore.record);
      setVisible(true);
    }
  }, []);

  // Scroll lock
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  // ESC dismiss
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible]);

  const dismiss = useCallback(() => {
    markWelcomed();
    setVisible(false);
  }, []);

  const handleFinalStep = useCallback(() => {
    markWelcomed();
    setVisible(false);
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) dismiss();
  }, [dismiss]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleRegister = useCallback(async () => {
    const trimmedName = regName.trim();
    const trimmedEmail = regEmail.trim();

    if (!trimmedName || !trimmedEmail || !regPassword) {
      setRegStatus('error');
      setRegError('请填写昵称、邮箱和密码');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
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

    const { success } = await registerReader({
      email: trimmedEmail,
      name: trimmedName,
      password: regPassword,
      passwordConfirm: regPassword,
    });

    if (success) {
      setRegisteredEmail(trimmedEmail);
      setRegStatus('success');
      // Auto-advance to the email-verification step now that the registration
      // step's success UI has rendered. Deferred so the success state paints
      // before the slide transition kicks in.
      scheduleTimeout(() => {
        stepperRef.current?.next();
      }, 600);
    } else {
      setRegStatus('error');
      setRegError('注册失败，邮箱可能已被注册');
    }
  }, [regName, regEmail, regPassword, registerReader]);

  const handleResendVerification = useCallback(async () => {
    if (!registeredEmail) return;
    setResendStatus('loading');
    const { success } = await requestVerification(registeredEmail);
    setResendStatus(success ? 'sent' : 'idle');
    if (success) {
      scheduleTimeout(() => setResendStatus('idle'), 5000);
    }
  }, [registeredEmail, requestVerification, scheduleTimeout]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="welcome-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleBackdropClick}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/60 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="欢迎引导"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className={isLandscapePhone ? 'w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4' : 'w-full max-w-lg'}
          >
            <Stepper
              ref={stepperRef}
              initialStep={1}
              onFinalStepCompleted={handleFinalStep}
              backButtonText="上一步"
              nextButtonText="下一步"
              completeButtonText="开始探索"
              hideFooterNext={(step) => !isLoggedIn && step === registrationStepNumber}
              stepCircleContainerClassName={isLandscapePhone ? 'landscape-compact' : ''}
              footerClassName={isLandscapePhone ? 'landscape-compact' : ''}
            >
              {/* Step 1: Welcome with SplitText */}
              <Step>
                <div className="flex flex-col items-center py-4 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-900/30">
                    <svg className="h-7 w-7 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                    <SplitText text="欢迎来到胡巴的博客" />
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    一个关于技术、思考与生活的个人空间。<br />
                    在这里记录所学所想，也期待与你交流。
                  </p>
                </div>
              </Step>

              {/* Step 2: Features with SpotlightCard */}
              <Step>
                <div className="py-4">
                  <h2 className="mb-4 text-center text-xl font-bold text-zinc-900 dark:text-zinc-50">
                    <SplitText text="探索功能" delay={0.1} />
                  </h2>
                  <div className="space-y-3">
                    {[
                      { icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z', title: '技术文章', desc: '涵盖前端、后端与开发实践' },
                      { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', title: '评论互动', desc: '分享你的想法，与作者和其他读者交流' },
                      { icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', title: '全文搜索', desc: '快速找到你感兴趣的内容' },
                    ].map((item) => (
                      <SpotlightCard key={item.title} className="px-3 py-2.5" spotlightSize={spotlightSize}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-900/30">
                            <svg className="h-4 w-4 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.desc}</p>
                          </div>
                        </div>
                      </SpotlightCard>
                    ))}
                  </div>
                </div>
              </Step>

              {/* Step 3: Community with social links */}
              <Step>
                <div className="py-4">
                  <h2 className="mb-4 text-center text-xl font-bold text-zinc-900 dark:text-zinc-50">
                    <SplitText text="加入社区" delay={0.1} />
                  </h2>
                  <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    关注我的动态，在评论区与我交流
                  </p>
                  <div className="flex justify-center gap-3">
                    <a
                      href="https://github.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 no-underline transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                      GitHub
                    </a>
                    <a
                      href="https://space.bilibili.com/691237475"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 no-underline transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.813 4.653h.354c.729 0 1.333.6 1.333 1.333v9.6c0 .734-.604 1.334-1.333 1.334h-.354a1.334 1.334 0 01-1.334-1.334v-9.6c0-.733.605-1.333 1.334-1.333zm-10.48 0h.354c.733 0 1.333.6 1.333 1.333v9.6c0 .734-.6 1.334-1.333 1.334h-.354A1.334 1.334 0 016 15.586v-9.6c0-.733.6-1.333 1.333-1.333zm5.667-2.626h-.354c-.734 0-1.334.6-1.334 1.333v.44H8.187a2.667 2.667 0 00-2.667 2.667v9.6a2.667 2.667 0 002.667 2.666h7.626a2.667 2.667 0 002.667-2.666v-9.6a2.667 2.667 0 00-2.667-2.667h-3.12v-.44c0-.733-.6-1.333-1.334-1.333h-.18z" /></svg>
                      Bilibili
                    </a>
                  </div>
                </div>
              </Step>

              {/* Step 4: Mini registration form (only for non-logged-in users) */}
              {!isLoggedIn && (
                <Step>
                  <div className="py-4">
                    <h2 className="mb-3 text-center text-xl font-bold text-zinc-900 dark:text-zinc-50">
                      <SplitText text="创建账户" delay={0.1} />
                    </h2>
                    <p className="mb-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      注册后即可发表评论，参与社区互动
                    </p>

                    {regStatus === 'success' ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center py-4 text-center"
                      >
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/30">
                          <svg className="h-6 w-6 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-teal-700 dark:text-teal-300">注册成功！</p>
                      </motion.div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">昵称</label>
                          <input
                            type="text"
                            value={regName}
                            onChange={(e) => { setRegName(e.target.value); if (regStatus === 'error') { setRegStatus('idle'); setRegError(''); } }}
                            placeholder="你的昵称"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-teal-400 focus-visible:ring-1 focus-visible:ring-teal-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            autoComplete="name"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">邮箱</label>
                          <input
                            type="email"
                            value={regEmail}
                            onChange={(e) => { setRegEmail(e.target.value); if (regStatus === 'error') { setRegStatus('idle'); setRegError(''); } }}
                            placeholder="your@email.com"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-teal-400 focus-visible:ring-1 focus-visible:ring-teal-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            autoComplete="email"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">密码</label>
                          <input
                            type="password"
                            value={regPassword}
                            onChange={(e) => { setRegPassword(e.target.value); if (regStatus === 'error') { setRegStatus('idle'); setRegError(''); } }}
                            placeholder="至少 8 个字符"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-teal-400 focus-visible:ring-1 focus-visible:ring-teal-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            autoComplete="new-password"
                          />
                        </div>

                        {regStatus === 'error' && regError && (
                          <p className="text-xs text-red-500 dark:text-red-400">{regError}</p>
                        )}

                        <button
                          type="button"
                          onClick={handleRegister}
                          disabled={regStatus === 'loading'}
                          className="w-full rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
                        >
                          {regStatus === 'loading' ? '注册中...' : '注册并继续'}
                        </button>

                        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
                          已有账户？<a href="/login" onClick={dismiss} className="text-teal-600 hover:underline dark:text-teal-400">登录</a>
                          <span className="mx-1.5">·</span>
                          <button type="button" onClick={() => setShowSkipConfirm(true)} className="text-teal-600 hover:underline dark:text-teal-400">跳过注册</button>
                        </p>

                        {showSkipConfirm && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
                          >
                            <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
                              未注册/登录将无法发表评论和参与互动，确定跳过吗？
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setShowSkipConfirm(false)}
                                className="rounded-md px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              >
                                返回注册
                              </button>
                              <button
                                type="button"
                                onClick={dismiss}
                                className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                              >
                                确定跳过
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                </Step>
              )}

              {/* Step 5: Email verification prompt (only after successful registration) */}
              {!isLoggedIn && regStatus === 'success' && (
                <Step>
                  <div className="py-4">
                    <h2 className="mb-3 text-center text-xl font-bold text-zinc-900 dark:text-zinc-50">
                      <SplitText text="验证邮箱" delay={0.1} />
                    </h2>
                    <div className="flex flex-col items-center text-center">
                      <motion.div
                        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-900/30"
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <svg className="h-7 w-7 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                      </motion.div>
                      <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-300">
                        验证邮件已发送至
                      </p>
                      <p className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {registeredEmail || regEmail.trim() || '你的邮箱'}
                      </p>
                      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                        请检查收件箱（含垃圾邮件），点击验证链接。<br />
                        验证后即可发表评论。
                      </p>
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={resendStatus === 'loading' || resendStatus === 'sent'}
                        className="rounded-lg border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        {resendStatus === 'loading' ? '发送中...' : resendStatus === 'sent' ? '已重新发送 ✓' : '重新发送验证邮件'}
                      </button>
                      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                        也可以稍后再验证，不影响浏览
                      </p>
                    </div>
                  </div>
                </Step>
              )}

              {/* Step 6 (or Step 4 for logged-in): Ready to explore */}
              <Step>
                <div className="flex flex-col items-center py-4 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-900/30">
                    <svg className="h-7 w-7 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                    <SplitText text="准备就绪" delay={0.1} />
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    点击下方按钮完成引导，开始探索博客内容。
                  </p>
                </div>
              </Step>
            </Stepper>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
