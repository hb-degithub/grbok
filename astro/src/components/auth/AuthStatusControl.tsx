import React, { useEffect, useRef, useState } from 'react';
import {
  getUserDisplayName,
  getUserInitial,
  ROLE_LABELS,
  useAuthStatus,
} from '../../hooks/useAuthStatus';

export default function AuthStatusControl() {
  const { user, isAuthenticated, isLoading, logout, canAccessAdmin } = useAuthStatus();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = getUserDisplayName(user);
  const initial = getUserInitial(user);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (isLoading) {
    return (
      <div className="h-[var(--tap)] w-[var(--tap)] animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800 sm:h-9 sm:w-20" aria-label="正在读取登录状态" />
    );
  }

  if (!isAuthenticated) {
    return (
      <a
        href="/login"
        className="focus-ring inline-flex h-[var(--tap)] items-center justify-center rounded-lg border border-zinc-200 bg-white/70 px-2 text-sm font-semibold text-zinc-700 no-underline shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white sm:h-9 sm:px-3"
      >
        登录
      </a>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring inline-flex h-[var(--tap)] w-[var(--tap)] items-center justify-center rounded-lg border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white sm:h-9 sm:w-auto sm:max-w-[11rem] sm:justify-start sm:gap-2 sm:px-2.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前已登录：${displayName}`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-xs font-black text-white dark:bg-zinc-100 dark:text-zinc-950">
          {initial}
        </span>
        <span className="hidden truncate sm:inline">{displayName}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-900/10 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95" role="menu">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-50">{displayName}</div>
            <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{user?.email || '已登录'}</div>
            {user?.role && (
              <div className="mt-2 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {ROLE_LABELS[user.role]}
              </div>
            )}
          </div>

          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

          {canAccessAdmin && (
            <a
              href="/admin"
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 no-underline transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
              role="menuitem"
            >
              <span>进入后台</span>
              <span aria-hidden="true">→</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => logout('/')}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
            role="menuitem"
          >
            <span>退出登录</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}
    </div>
  );
}
