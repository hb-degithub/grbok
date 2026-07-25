import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

type VerifyStatus = 'loading' | 'success' | 'error' | 'already_verified';

export default function EmailVerificationResult() {
  const [status, setStatus] = useState<VerifyStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage('缺少验证令牌');
      return;
    }

    const pb = getPocketBase();
    pb.collection('users').confirmVerification(token)
      .then(() => {
        setStatus('success');
        // Refresh auth store to update verified
        return pb.collection('users').authRefresh();
      })
      .catch((err) => {
        const msg = err?.response?.data?.message || err?.message || '';
        if (msg.includes('already') || msg.includes('已验证')) {
          setStatus('already_verified');
        } else {
          setStatus('error');
          setErrorMessage(msg || '验证失败，请重新发送验证邮件');
        }
      });
  }, []);

  // Auto-redirect after success
  useEffect(() => {
    if (status === 'success' || status === 'already_verified') {
      const timer = setTimeout(() => {
        window.location.href = '/';
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const iconVariants = {
    hidden: { scale: 0, rotate: -180 },
    visible: { scale: 1, rotate: 0, transition: { type: 'spring' as const, stiffness: 200, damping: 15 } },
  };

  return (
    <div className="flex min-h-[60svh] items-center justify-center px-4">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="card max-w-md rounded-xl p-8 text-center"
      >
        {status === 'loading' && (
          <>
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-teal-500" />
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">正在验证邮箱...</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <motion.div variants={iconVariants} initial="hidden" animate="visible" className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-8 w-8 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
            <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-300">邮箱验证成功！</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">3 秒后自动跳转首页...</p>
          </>
        )}

        {status === 'already_verified' && (
          <>
            <motion.div variants={iconVariants} initial="hidden" animate="visible" className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </motion.div>
            <h2 className="text-xl font-bold text-blue-700 dark:text-blue-300">邮箱已验证</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">3 秒后自动跳转首页...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-red-700 dark:text-red-300">验证失败</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{errorMessage}</p>
            <a href="/login" className="mt-4 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white no-underline transition-colors hover:bg-teal-700">
              返回登录
            </a>
          </>
        )}
      </motion.div>
    </div>
  );
}
