import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchAdminVerificationStatus, registerAdminPasskey, requestAdminPasskeyVerification } from '../../lib/admin-passkey';
import Button from '../ui/Button';

interface AdminPasskeyStepProps {
  onReturnToLogin?: () => void;
  mode?: 'verify' | 'bootstrap';
}

export default function AdminPasskeyStep({ onReturnToLogin, mode }: AdminPasskeyStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [resolvedMode, setResolvedMode] = useState<'verify' | 'bootstrap'>(mode || 'verify');
  const [label, setLabel] = useState('Primary Passkey');

  useEffect(() => {
    if (mode) return;
    fetchAdminVerificationStatus()
      .then((result) => setResolvedMode(result.status === 'bootstrap_required' ? 'bootstrap' : 'verify'))
      .catch(() => setResolvedMode('verify'));
  }, [mode]);

  const handleVerify = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      if (resolvedMode === 'bootstrap') await registerAdminPasskey(label.trim() || 'Primary Passkey');
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
        {resolvedMode === 'bootstrap' ? '首次进入需在可信管理网络注册 Passkey' : '需要 Passkey 验证以进入管理后台'}
      </div>
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        {resolvedMode === 'bootstrap' ? '注册完成后将立即使用新 Passkey 完成当前标签页的安全验证。' : '请使用已注册的 Passkey 完成验证。'}
      </div>
      {resolvedMode === 'bootstrap' && (
        <label className="block text-sm text-zinc-600 dark:text-zinc-300">
          Passkey 标签
          <input className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
      )}
      {status === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>}
      <Button type="button" variant="primary" size="lg" loading={status === 'loading'} onClick={handleVerify} className="w-full">
        {status === 'loading' ? '处理中…' : resolvedMode === 'bootstrap' ? '注册并验证 Passkey' : '使用 Passkey 验证'}
      </Button>
      {onReturnToLogin && <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">返回登录</Button>}
    </motion.div>
  );
}
