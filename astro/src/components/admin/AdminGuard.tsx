import React from 'react';
import { useAdminAuth, type AdminRole } from '../../hooks/useAdminAuth';
import { useAdminVerification } from '../../hooks/useAdminVerification';
import AdminPasskeyStep from '../auth/AdminPasskeyStep';
import AdminEmailVerificationRequired from './AdminEmailVerificationRequired';
import { useAdminLogout } from '../../hooks/useAdminAuth';

interface Props { children: React.ReactNode; requiredRole?: AdminRole; }

export default function AdminGuard({ children, requiredRole = 'author' }: Props) {
  const { isAuthenticated, isLoading, hasPermission, user } = useAdminAuth();
  const { isChecking: isVerifying, isVerified } = useAdminVerification();
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

  // Admin must verify email before passkey step
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

  if (!isVerified) return (
    <div className="flex min-h-[100svh] items-center justify-center bg-bg">
      <div className="card max-w-md rounded-lg p-8">
        <AdminPasskeyStep onReturnToLogin={logout} />
      </div>
    </div>
  );

  return <>{children}</>;
}
