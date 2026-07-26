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
      <div className="flex min-h-[100svh] items-center justify-center bg-bg">
        <div className="card max-w-md rounded-lg p-8">
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
      <div className="flex min-h-[100svh] items-center justify-center bg-bg">
        <div className="card max-w-md rounded-lg p-8 text-center">
          <p className="text-sm text-text-secondary">无法获取二次验证状态（网络或边缘节点异常）。</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={refreshVerification} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">重试</button>
            <button type="button" onClick={logout} className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:bg-bg">返回登录</button>
          </div>
        </div>
      </div>
    );
  }

  if (!isVerified) {
    const needsSetup = status === 'totp_setup_required' || status === 'recovery_reenroll';
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-bg">
        <div className="card max-w-md rounded-lg p-8">
          {needsSetup
            ? <TotpSetupStep mode={status === 'recovery_reenroll' ? 'recovery' : 'setup'} onReturnToLogin={logout} />
            : <TotpVerifyStep onReturnToLogin={logout} />}
        </div>
      </div>
    );
  }

  return <>{children}<StepUpRecoveryModal /></>;
}
