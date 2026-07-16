import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchAdminVerificationStatus, registerAdminPasskey, requestAdminPasskeyVerification } from '../../lib/admin-passkey';
import { saveAdminRecoveryCode } from '../../lib/admin-step-up';
import Button from '../ui/Button';

interface AdminPasskeyStepProps {
  onReturnToLogin?: () => void;
  mode?: 'verify' | 'bootstrap' | 'recovery';
}

export default function AdminPasskeyStep({ onReturnToLogin, mode }: AdminPasskeyStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [resolvedMode, setResolvedMode] = useState<'verify' | 'bootstrap' | 'recovery'>(mode || 'verify');
  const [label, setLabel] = useState('Primary Passkey');
  const [recoveryCode, setRecoveryCode] = useState('');

  useEffect(() => {
    if (mode) return;
    fetchAdminVerificationStatus()
      .then((result) => setResolvedMode(result.status === 'bootstrap_required' ? 'bootstrap' : result.status === 'recovery_reenroll' ? 'recovery' : 'verify'))
      .catch(() => setResolvedMode('verify'));
  }, [mode]);

  const handleVerify = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      if (resolvedMode === 'verify' && recoveryCode.trim()) {
        saveAdminRecoveryCode(recoveryCode);
        const recoveryStatus = await fetchAdminVerificationStatus();
        if (recoveryStatus.status !== 'recovery_reenroll') throw new Error('恢复码无效或已过期');
        setResolvedMode('recovery');
        await registerAdminPasskey(label.trim() || 'Recovered Passkey');
      } else if (resolvedMode === 'bootstrap' || resolvedMode === 'recovery') {
        await registerAdminPasskey(label.trim() || (resolvedMode === 'recovery' ? 'Recovered Passkey' : 'Primary Passkey'));
      }
      const result = await requestAdminPasskeyVerification();
      if (result.verified) { window.location.href = '/admin'; return; }
      setStatus('error');
      setErrorMessage('Passkey 验证失败');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Passkey 验证失败');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        {resolvedMode === 'bootstrap' ? '首次进入需在可信管理网络注册 Passkey' : resolvedMode === 'recovery' ? '使用一次性恢复码重新注册 Passkey' : '需要 Passkey 验证以进入管理后台'}
      </div>
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        {resolvedMode === 'bootstrap' || resolvedMode === 'recovery' ? '注册完成后将立即使用新 Passkey 完成当前标签页的安全验证。' : '请使用已注册的 Passkey 完成验证；若全部凭据丢失，可输入宿主机脚本显示的一次性恢复码。'}
      </div>
      {(resolvedMode === 'bootstrap' || resolvedMode === 'recovery') && (
        <label className="block text-sm text-zinc-600 dark:text-zinc-300">
          Passkey 标签
          <input className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
      )}
      {resolvedMode === 'verify' && (
        <label className="block text-sm text-zinc-600 dark:text-zinc-300">
          一次性恢复码（仅凭据全部丢失时）
          <input className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" />
        </label>
      )}
      {status === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>}
      <Button type="button" variant="primary" size="lg" loading={status === 'loading'} onClick={handleVerify} className="w-full">
        {status === 'loading' ? '处理中…' : resolvedMode === 'bootstrap' || resolvedMode === 'recovery' || recoveryCode.trim() ? '注册并验证 Passkey' : '使用 Passkey 验证'}
      </Button>
      {onReturnToLogin && <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">返回登录</Button>}
    </motion.div>
  );
}
