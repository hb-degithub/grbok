import React from 'react';
import {
  getUserDisplayName,
  getUserInitial,
  ROLE_LABELS,
  useAuthStatus,
} from '../../hooks/useAuthStatus';

const linkClass = 'side-link group flex min-h-[44px] items-center justify-between rounded-[2px] border border-[var(--sf-line-soft)] px-3 py-3 text-sm font-semibold text-[var(--sf-ink-2)] no-underline transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent)]';

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
      <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-3 py-3" aria-label="正在读取登录状态">
        <div className="h-4 w-28 animate-pulse rounded-[1px] bg-[var(--sf-line-soft)]" />
        <div className="mt-2 h-3 w-40 animate-pulse rounded-[1px] bg-[var(--sf-line-soft)]" />
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
      <div className="rounded-[2px] border border-[var(--sf-line)] px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] bg-[var(--sf-accent)] text-sm font-black text-[var(--sf-on-accent)]">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-[var(--sf-ink)]">{displayName}</div>
            <div className="truncate text-xs text-[var(--sf-ink-3)]">{user?.email || '已登录'}</div>
          </div>
        </div>
        {user?.role && (
          <div className="mt-3 inline-flex rounded-[2px] border border-[var(--sf-line)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sf-ink-2)]">
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
        className="side-link group flex min-h-[44px] w-full items-center justify-between rounded-[2px] border border-[var(--sf-line-soft)] px-3 py-3 text-left text-sm font-semibold text-[var(--sf-danger)] transition-colors hover:border-[var(--sf-danger)]"
      >
        <span>退出登录</span>
        <ArrowIcon />
      </button>
    </>
  );
}
