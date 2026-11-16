import { useState, useEffect, useCallback } from 'react';
import { fetchAdminVerificationStatus } from '../lib/admin-totp';
import { getPocketBase } from '../lib/pocketbase';
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
    // 2026-11-16：未登录（或 token 已失效）时不要打 step-up 状态接口。
    // 管理页在跳转 /login 之前会先挂载一次，此前每次匿名访问都会连发 3 次 401
    // （该接口内部有两次重试），既污染控制台也给边缘 WAF 增加可疑流量。
    const pb = getPocketBase();
    if (!pb.authStore.isValid) {
      setIsVerified(false);
      setExpiresAt(null);
      setStatus('expired');
      setIsChecking(false);
      return;
    }
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
