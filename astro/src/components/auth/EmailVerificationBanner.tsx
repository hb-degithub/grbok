import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { requestVerification } from '../../lib/blog-auth-client';

interface EmailVerificationBannerProps {
  email: string;
  /** If true, show a highlighted "just sent" message (from ?verify_email_sent=1) */
  initialHighlight?: boolean;
}

export default function EmailVerificationBanner({ email, initialHighlight = false }: EmailVerificationBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    initialHighlight ? 'sent' : 'idle',
  );
  const [highlight, setHighlight] = useState(initialHighlight);
  useEffect(() => {
    if (highlight) {
      const timer = setTimeout(() => setHighlight(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [highlight]);

  const handleResend = useCallback(async () => {
    setStatus('sending');
    try {
      await requestVerification(email);
      setStatus('sent');
    } catch (err) {
      console.error('Resend verification failed:', err);
      setStatus('error');
    }
  }, [email]);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className={`rounded-xl border px-4 py-3 text-sm ${
          highlight
            ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200'
            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
        }`}
        role="status"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="font-medium">
              {highlight ? '验证邮件已发送到你的邮箱，请查收' : '你的邮箱尚未验证'}
            </p>
            <p className="mt-1 text-amber-600 dark:text-amber-300">
              {status === 'sent' ? (
                '验证邮件已发送，请检查收件箱（含垃圾邮件）'
              ) : status === 'error' ? (
                '发送失败，请稍后重试'
              ) : status === 'sending' ? (
                '正在发送...'
              ) : (
                <>
                  验证后即可发表评论。{' '}
                  <button
                    type="button"
                    onClick={handleResend}
                    className="underline hover:no-underline"
                  >
                    重新发送验证邮件
                  </button>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded-md p-2 sm:p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
            aria-label="关闭提示"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
