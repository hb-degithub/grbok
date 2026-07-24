import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import { useAdminVerification } from '../../hooks/useAdminVerification';
import TotpSetupStep from '../auth/TotpSetupStep';
import TotpVerifyStep from '../auth/TotpVerifyStep';
import AdminEmailVerificationRequired from './AdminEmailVerificationRequired';
import { useAdminLogout } from '../../hooks/useAdminAuth';

interface Props { children: React.ReactNode; requiredRole?: AdminRole; }

export default function AdminGuard({ children, requiredRole = 'author' }: Props) {
  const { isAuthenticated, isLoading, hasPermission, user } = useAdminAuth();
  const { isChecking: isVerifying, isVerified, status } = useAdminVerification();
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
  if (user && !user.emailVerified) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-bg">
        <div className="card max-w-md rounded-lg p-8">
          <AdminEmailVerificationRequired user={user} onReturnToLogin={logout} />
        </div>
      </div>
    );
  }

  if (isVerifying) return null;

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

  return <>{children}</>;
}
