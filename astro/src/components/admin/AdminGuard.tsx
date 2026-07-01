import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import { useAdminVerification } from '../../hooks/useAdminVerification';
import AdminPasskeyStep from '../auth/AdminPasskeyStep';
import { useAdminLogout } from '../../hooks/useAdminAuth';

interface Props { children: React.ReactNode; requiredRole?: AdminRole; }

const copy = {
  login标题: '\u9700\u8981\u767b\u5f55',
  loginMessage: '\u8bf7\u5148\u767b\u5f55\u540e\u518d\u8bbf\u95ee\u7ba1\u7406\u540e\u53f0',
  loginLink: '\u53bb\u767b\u5f55',
  homeLink: '\u8fd4\u56de\u9996\u9875',
  denied标题: '\u6743\u9650\u4e0d\u8db3',
  deniedPrefix: '\u5f53\u524d\u89d2\u8272 "',
  deniedSuffix: '" \u65e0\u6743\u8bbf\u95ee\u6b64\u9875\u9762',
  requiredPrefix: '\u9700\u8981 ',
  requiredSuffix: ' \u6216\u66f4\u9ad8\u6743\u9650',
};

export default function AdminGuard({ children, requiredRole = 'author' }: Props) {
  const { isAuthenticated, isLoading, user, hasPermission } = useAdminAuth();
  const { isChecking: isVerifying, isVerified } = useAdminVerification();
  const { logout } = useAdminLogout();

  if (isLoading) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card rounded-lg p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-zinc-500" />
        <p className="font-mono text-xs uppercase tracking-widest text-text-secondary">正在验证身份...</p>
      </div>
    </div>
  );

  if (!isAuthenticated) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card max-w-md rounded-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/15">
          <svg className="h-8 w-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-text">{copy.login标题}</h2>
        <p className="mb-6 text-sm text-text-secondary">{copy.loginMessage}</p>
        <div className="flex justify-center gap-3">
          <a href="/login" className="btn-primary inline-block text-xs">{copy.loginLink}</a>
          <a href="/" className="btn-ghost inline-block text-xs">{copy.homeLink}</a>
        </div>
      </div>
    </div>
  );

  if (!hasPermission(requiredRole)) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card max-w-md rounded-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/15">
          <svg className="h-8 w-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-text">{copy.denied标题}</h2>
        <p className="mb-2 text-sm text-text-secondary">{copy.deniedPrefix}{user?.role}{copy.deniedSuffix}</p>
        <p className="mb-6 text-xs text-text-muted">{copy.requiredPrefix}{requiredRole}{copy.requiredSuffix}</p>
        <a href="/" className="btn-ghost inline-block text-xs">{copy.homeLink}</a>
      </div>
    </div>
  );

  if (isVerifying) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card rounded-lg p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-zinc-500" />
        <p className="font-mono text-xs uppercase tracking-widest text-text-secondary">正在验证管理员会话...</p>
      </div>
    </div>
  );

  if (!isVerified) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card max-w-md rounded-lg p-8">
        <AdminPasskeyStep onReturnToLogin={logout} />
      </div>
    </div>
  );

  return <>{children}</>;
}
