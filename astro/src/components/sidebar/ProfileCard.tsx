import React from 'react';
import { motion } from 'framer-motion';
import { useSiteCounts } from '../../hooks/domains/useSiteCounts';
import { useAuthStatus, getUserDisplayName, getUserInitial } from '../../hooks/useAuthStatus';
import { SITE_CONFIG } from '../../config/site';
import CountUp from '../reactbits/CountUp';

/**
 * 首页作者信息块：登录后显示当前账号与站点统计，未登录显示登录入口。
 *
 * 视觉迁移到 --sf-* 令牌（冷灰细线、3px 圆角、等宽短标签），
 * 数据来源（useSiteCounts / useAuthStatus）、加载与空态、登录/注销行为保持改造前实现。
 */

const EYEBROW_CLASS =
  'font-mono text-[0.625rem] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]';
const TITLE_CLASS = 'mt-1 truncate text-lg font-bold tracking-tight text-[var(--sf-ink)]';
const META_CLASS = 'mt-1 truncate text-xs text-[var(--sf-ink-3)]';
const AVATAR_CLASS =
  'flex h-16 w-16 shrink-0 items-center justify-center rounded-[3px] border border-[var(--sf-line-strong)] bg-[var(--sf-canvas)]';
const STAT_VALUE_CLASS = 'text-base font-bold text-[var(--sf-ink)]';
const STAT_LABEL_CLASS =
  'font-mono text-[0.625rem] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const PRIMARY_ACTION_CLASS =
  'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[3px] bg-[var(--sf-accent)] px-4 text-sm font-medium text-[var(--sf-on-accent)] no-underline transition-colors hover:bg-[var(--sf-accent-ink)]';
const GHOST_ACTION_CLASS =
  'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 text-sm font-medium text-[var(--sf-ink)] no-underline transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';
const GHOST_BUTTON_CLASS =
  'inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-4 text-sm font-medium text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]';

export default function ProfileCard() {
  const { stats, mounted } = useSiteCounts();
  const { user, isAuthenticated, logout } = useAuthStatus();

  // 已登录：显示当前用户信息
  if (isAuthenticated && user) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex h-full min-w-0 flex-col"
      >
        <div className="flex items-center gap-4">
          <div className={AVATAR_CLASS}>
            <span className="font-mono text-xl font-bold text-[var(--sf-accent-ink)]">
              {getUserInitial(user)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className={EYEBROW_CLASS}>ACCOUNT / ONLINE</p>
            <h3 className={TITLE_CLASS}>{getUserDisplayName(user)}</h3>
            <p className={META_CLASS}>{user.email || '已登录用户'}</p>
          </div>
        </div>
        {mounted && (
          <div className="mt-6 grid grid-cols-3 gap-2 border-y border-[var(--sf-line-soft)] py-4">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col items-center gap-0.5">
                <CountUp to={Number(stat.value)} duration={1.5} className={STAT_VALUE_CLASS} />
                <span className={STAT_LABEL_CLASS}>{stat.label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto flex gap-2 pt-6">
          <a href="/admin" className={PRIMARY_ACTION_CLASS}>用户中心</a>
          <button type="button" onClick={() => logout('/')} className={GHOST_BUTTON_CLASS}>退出登录</button>
        </div>
      </motion.div>
    );
  }

  // 未登录：显示作者与登录提示
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex items-center gap-4">
        <div className={AVATAR_CLASS}>
          <svg className="h-8 w-8 text-[var(--sf-ink-3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className={EYEBROW_CLASS}>AUTHOR / {SITE_CONFIG.author}</p>
          <h3 className={TITLE_CLASS}>未登录</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--sf-ink-3)]">登录后可评论、点赞、管理内容</p>
        </div>
      </div>
      <div className="mt-auto flex gap-2 pt-6">
        <a href="/login" className={PRIMARY_ACTION_CLASS}>登录</a>
        <a href="/about" className={GHOST_ACTION_CLASS}>关于</a>
      </div>
    </motion.div>
  );
}
