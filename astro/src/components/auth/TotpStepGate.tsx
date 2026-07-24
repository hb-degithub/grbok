import React, { useEffect, useState } from 'react';
import { fetchAdminVerificationStatus, type AdminStepUpStatus } from '../../lib/admin-totp';
import TotpSetupStep from './TotpSetupStep';
import TotpVerifyStep from './TotpVerifyStep';

interface TotpStepGateProps {
  onReturnToLogin?: () => void;
}

/** 登录后二次验证入口：按后端状态自动选择绑定（setup/recovery）或验证（verify）界面 */
export default function TotpStepGate({ onReturnToLogin }: TotpStepGateProps) {
  const [status, setStatus] = useState<AdminStepUpStatus | null>(null);

  useEffect(() => {
    fetchAdminVerificationStatus()
      .then((result) => setStatus(result.status))
      .catch(() => setStatus('expired'));
  }, []);

  if (status === null) return null;

  if (status === 'totp_setup_required' || status === 'recovery_reenroll') {
    return <TotpSetupStep mode={status === 'recovery_reenroll' ? 'recovery' : 'setup'} onReturnToLogin={onReturnToLogin} />;
  }
  return <TotpVerifyStep onReturnToLogin={onReturnToLogin} />;
}
