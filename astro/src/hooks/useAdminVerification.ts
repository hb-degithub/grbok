import { useState, useEffect, useCallback } from 'react';
import { fetchAdminVerificationStatus } from '../lib/admin-passkey';

export interface AdminVerificationState {
  isChecking: boolean;
  isVerified: boolean;
  expiresAt: string | null;
  refresh: () => void;
}

export function useAdminVerification(): AdminVerificationState {
  const [isChecking, setIsChecking] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setIsChecking(true);
    fetchAdminVerificationStatus()
      .then((result) => {
        setIsVerified(result.verified);
        setExpiresAt(result.expires_at || null);
      })
      .catch(() => {
        setIsVerified(false);
        setExpiresAt(null);
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { isChecking, isVerified, expiresAt, refresh };
}
