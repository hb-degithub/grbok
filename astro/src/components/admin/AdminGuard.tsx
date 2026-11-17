import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import { useAdminVerification } from '../../hooks/useAdminVerification';
import TotpSetupStep from '../auth/TotpSetupStep';
import TotpVerifyStep from '../auth/TotpVerifyStep';
import AdminEmailVerificationRequired from './AdminEmailVerificationRequired';
import StepUpRecoveryModal from './StepUpRecoveryModal';
import { useAdminLogout } from '../../hooks/useAdminAuth';

interface Props { children: React.ReactNode; requiredRole?: AdminRole; }

export default function AdminGuard({ children, requiredRole = 'author' }: Props) {
  const { isAuthenticated, isLoading, hasPermission, user, role } = useAdminAuth();
  const { isChecking: isVerifying, isVerified, isError: isVerificationError, status, refresh: refreshVerification } = useAdminVerification();
  const { logout } = useAdminLogout();

  if (isLoading) return null;

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }

  if (!hasPermission(requiredRole)) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  // Admin must verify email before TOTP step
  if (user && !user.verified) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-[var(--sf-canvas)]">
        <div className="max-w-md rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-8">
          <AdminEmailVerificationRequired user={user} onReturnToLogin={logout} />
        </div>
      </div>
    );
  }

  // 仅 admin / super_admin 强制 TOTP；author 等角色在邮箱验证通过后直接放行
  if (role === 'author') {
    return <>{children}<StepUpRecoveryModal /></>;
  }

  if (isVerifying) return null;

  if (isVerificationError) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-[var(--sf-canvas)]">
        <div className="max-w-md rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-8 text-center">
          <p className="text-sm text-[var(--sf-ink-2)]">无法获取二次验证状态（网络或边缘节点异常）。</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={refreshVerification} className="rounded-[2px] bg-[var(--sf-accent)] px-4 py-2 text-sm font-medium text-[var(--sf-on-accent)] transition-colors hover:bg-[var(--sf-accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]">重试</button>
            <button type="button" onClick={logout} className="rounded-[2px] border border-[var(--sf-line)] px-4 py-2 text-sm text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-line-strong)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)]">返回登录</button>
          </div>
        </div>
      </div>
    );
  }

  if (!isVerified) {
    const needsSetup = status === 'totp_setup_required' || status === 'recovery_reenroll';
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-[var(--sf-canvas)]">
        <div className="max-w-md rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-8">
          {needsSetup
            ? <TotpSetupStep mode={status === 'recovery_reenroll' ? 'recovery' : 'setup'} onReturnToLogin={logout} />
            : <TotpVerifyStep onReturnToLogin={logout} />}
        </div>
      </div>
    );
  }

  return <>{children}<StepUpRecoveryModal /></>;
}
