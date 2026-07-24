import { useState, useEffect, useCallback } from 'react';
import { fetchAdminVerificationStatus } from '../lib/admin-totp';
import type { AdminStepUpStatus } from '../lib/admin-totp';

export interface AdminVerificationState {
  isChecking: boolean;
  isVerified: boolean;
  expiresAt: string | null;
  status: AdminStepUpStatus;
  refresh: () => void;
}

export function useAdminVerification(): AdminVerificationState {
  const [isChecking, setIsChecking] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminStepUpStatus>('expired');

  const refresh = useCallback(() => {
    setIsChecking(true);
    fetchAdminVerificationStatus()
      .then((result) => {
        setIsVerified(result.verified);
        setExpiresAt(result.expiresAt || null);
        setStatus(result.status);
      })
      .catch(() => {
        setIsVerified(false);
        setExpiresAt(null);
        setStatus('expired');
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { isChecking, isVerified, expiresAt, status, refresh };
}
