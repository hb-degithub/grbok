import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';

interface Props { children: React.ReactNode; requiredRole?: AdminRole; }

export default function AdminGuard({ children, requiredRole = 'author' }: Props) {
  const { isAuthenticated, isLoading, user, hasPermission } = useAdminAuth();

  if (isLoading) return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="card rounded-2xl p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-indigo-500" />
        <p className="font-mono text-xs uppercase tracking-widest text-text-secondary">Authenticating...</p>
      </div>
    </div>
  );

  if (!isAuthenticated) return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="card max-w-md rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/15">
          <svg className="h-8 w-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-text">需要登录</h2>
        <p className="mb-6 text-sm text-text-secondary">请先登录后再访问管理后台</p>
        <div className="flex justify-center gap-3">
          <a href="/login" className="btn-primary inline-block text-xs">去登录</a>
          <a href="/" className="btn-ghost inline-block text-xs">返回首页</a>
        </div>
      </div>
    </div>
  );

  if (!hasPermission(requiredRole)) return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="card max-w-md rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/15">
          <svg className="h-8 w-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-text">权限不足</h2>
        <p className="mb-2 text-sm text-text-secondary">当前角色 "{user?.role}" 无权访问此页面</p>
        <p className="mb-6 text-xs text-text-muted">需要 {requiredRole} 或更高权限</p>
        <a href="/" className="btn-ghost inline-block text-xs">返回首页</a>
      </div>
    </div>
  );

  return <>{children}</>;
}
