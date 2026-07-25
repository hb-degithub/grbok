import React, { useEffect, useState } from 'react';
import { fetchAdminVerificationStatus, type AdminStepUpStatus } from '../../lib/admin-totp';
import TotpSetupStep from './TotpSetupStep';
import TotpVerifyStep from './TotpVerifyStep';
import Button from '../ui/Button';

interface TotpStepGateProps {
  onReturnToLogin?: () => void;
}

/** 登录后二次验证入口：按后端状态自动选择绑定（setup/recovery）或验证（verify）界面 */
export default function TotpStepGate({ onReturnToLogin }: TotpStepGateProps) {
  const [status, setStatus] = useState<AdminStepUpStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchAdminVerificationStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result.status);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[TotpStepGate] step-up/status failed:', err);
        // 状态未知时不要乱猜分支（曾把已绑定用户误带进绑定页）：
        // 显示错误态让用户主动重试，比默认 setup/verify 都安全。
        setFailed(true);
      });
    return () => { cancelled = true; };
  }, [attempt]);

  if (failed) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          无法获取二次验证状态（网络或边缘节点异常），请重试。
        </div>
        <Button type="button" variant="primary" size="lg" className="w-full" onClick={() => setAttempt((n) => n + 1)}>
          重试
        </Button>
        {onReturnToLogin && <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">返回登录</Button>}
      </div>
    );
  }

  if (status === null) return null;

  if (status === 'totp_setup_required' || status === 'recovery_reenroll') {
    return <TotpSetupStep mode={status === 'recovery_reenroll' ? 'recovery' : 'setup'} onReturnToLogin={onReturnToLogin} />;
  }
  return <TotpVerifyStep onReturnToLogin={onReturnToLogin} />;
}
