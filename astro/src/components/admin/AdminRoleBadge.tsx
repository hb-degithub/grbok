import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';

/**
 * 顶栏「当前角色」徽标。
 *
 * 只读 `useAdminAuth().user` 的真实登录角色，用来和同一行的「本页要求」（页面
 * 门槛，来自 AdminLayout 的 requiredRole）区分开：前者是账号事实，后者是本页
 * 准入条件。纯展示，不参与鉴权、跳转或任何写操作（鉴权仍由 AdminGuard 负责）。
 */

const roleLabels: Record<AdminRole, string> = {
  reader: '普通用户',
  author: '作者',
  admin: '管理员',
  super_admin: '超级管理员',
};

const shellClass =
  'inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border bg-[var(--sf-surface)] px-3 py-1.5 font-mono';

export default function AdminRoleBadge() {
  const { user, role, isLoading } = useAdminAuth();
  const label = role ? roleLabels[role] : null;

  if (isLoading) {
    return (
      <span
        className={`${shellClass} border-[var(--sf-line)] text-[var(--sf-ink-3)]`}
        data-role-state="loading"
        aria-live="polite"
      >
        角色同步中
      </span>
    );
  }

  if (!user || !label) {
    return (
      <span
        className={`${shellClass} border-[var(--sf-line)] text-[var(--sf-ink-3)]`}
        data-role-state="unknown"
      >
        未识别角色
      </span>
    );
  }

  return (
    <span
      className={`${shellClass} border-[var(--sf-accent)] text-[var(--sf-ink)]`}
      data-role-state="ready"
      data-role={role}
      title={`当前登录账号：${user.email || user.name || '已登录'} · ${label}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sf-accent)]" aria-hidden="true" />
      <span className="text-[var(--sf-ink-3)]">当前角色</span>
      <span className="font-semibold text-[var(--sf-ink)]" data-role-label>
        {label}
      </span>
    </span>
  );
}
