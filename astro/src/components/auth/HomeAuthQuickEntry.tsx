import React from 'react';
import {
  getUserDisplayName,
  getUserInitial,
  ROLE_LABELS,
  useAuthStatus,
} from '../../hooks/useAuthStatus';

const linkClass = 'side-link group flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700 no-underline transition-all hover:bg-zinc-900 hover:text-white dark:bg-zinc-950/50 dark:text-zinc-300 dark:hover:bg-zinc-100 dark:hover:text-zinc-950';

function ArrowIcon() {
  return (
    <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function HomeAuthQuickEntry() {
  const { user, isAuthenticated, isLoading, logout, canAccessAdmin } = useAuthStatus();
  const displayName = getUserDisplayName(user);
  const initial = getUserInitial(user);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-950/50" aria-label="正在读取登录状态">
        <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-3 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <a href="/login" className={linkClass}>
        <span>登录 / 注册</span>
        <ArrowIcon />
      </a>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-sm font-black text-white dark:bg-zinc-100 dark:text-zinc-950">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-zinc-950 dark:text-zinc-50">{displayName}</div>
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user?.email || '已登录'}</div>
          </div>
        </div>
        {user?.role && (
          <div className="mt-3 inline-flex rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {ROLE_LABELS[user.role]}
          </div>
        )}
      </div>

      {canAccessAdmin && (
        <a href="/admin" className={linkClass}>
          <span>管理后台</span>
          <ArrowIcon />
        </a>
      )}

      <button
        type="button"
        onClick={() => logout('/')}
        className="side-link group flex w-full items-center justify-between rounded-lg bg-zinc-50 px-4 py-3 text-left text-sm font-semibold text-red-600 transition-all hover:bg-red-50 dark:bg-zinc-950/50 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        <span>退出登录</span>
        <ArrowIcon />
      </button>
    </>
  );
}
