import { useState, useEffect, useCallback } from 'react';
import { fetchAdminVerificationStatus } from '../lib/admin-totp';
import type { AdminStepUpStatus } from '../lib/admin-totp';

export interface AdminVerificationState {
  isChecking: boolean;
  isVerified: boolean;
  isError: boolean;
  expiresAt: string | null;
  status: AdminStepUpStatus;
  refresh: () => void;
}

export function useAdminVerification(): AdminVerificationState {
  const [isChecking, setIsChecking] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [isError, setIsError] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminStepUpStatus>('expired');

  const refresh = useCallback(() => {
    setIsChecking(true);
    setIsError(false);
    fetchAdminVerificationStatus()
      .then((result) => {
        setIsVerified(result.verified);
        setExpiresAt(result.expiresAt || null);
        setStatus(result.status);
      })
      .catch((err) => {
        setIsVerified(false);
        setExpiresAt(null);
        // 401：登录态失效，回登录页。
        // 其他错误（网络/边缘节点异常）：标记错误态，由界面提供重试，
        // 不要乱猜 setup/verify 分支（曾把已绑定用户误带进绑定页）。
        if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 401) {
          if (typeof window !== 'undefined') window.location.href = '/login';
          setStatus('expired');
          return;
        }
        setIsError(true);
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { isChecking, isVerified, isError, expiresAt, status, refresh };
}
