import React from 'react';
import { motion } from 'framer-motion';
import { useSiteCounts } from '../../hooks/domains/useSiteCounts';
import { useAuthStatus, getUserDisplayName, getUserInitial } from '../../hooks/useAuthStatus';
import { SITE_CONFIG } from '../../config/site';
import CountUp from '../reactbits/CountUp';

export default function ProfileCard() {
  const { stats, mounted } = useSiteCounts();
  const { user, isAuthenticated, logout } = useAuthStatus();

  // 已登录：显示当前用户信息
  if (isAuthenticated && user) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3 text-center">
        <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border-2 border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-900/20">
          <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">{getUserInitial(user)}</span>
        </div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{getUserDisplayName(user)}</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{user.email || '已登录用户'}</p>
        {mounted && (
        <div className="mt-5 flex items-center justify-center gap-6 text-xs text-zinc-500 dark:text-zinc-400">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-0.5">
              <CountUp to={Number(stat.value)} duration={1.5} className="text-base font-bold text-zinc-900 dark:text-zinc-50" />
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
        )}
        <div className="mt-6 flex gap-2">
          <a href="/admin" className="btn-primary flex-1 text-xs">用户中心</a>
          <button onClick={() => logout('/')} className="btn-ghost flex-1 text-xs">退出登录</button>
        </div>
      </motion.div>
    );
  }

  // 未登录：显示登录提示
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3 text-center">
      <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border-2 border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        <svg className="h-10 w-10 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">未登录</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">登录后可评论、点赞、管理内容</p>
      <div className="mt-6 flex gap-2">
        <a href="/login" className="btn-primary flex-1 text-xs">登录</a>
        <a href="/about" className="btn-ghost flex-1 text-xs">关于</a>
      </div>
    </motion.div>
  );
}
