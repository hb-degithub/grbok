import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { requestAdminPasskeyVerification } from '../../lib/admin-passkey';
import Button from '../ui/Button';

interface AdminPasskeyStepProps {
  onReturnToLogin?: () => void;
}

export default function AdminPasskeyStep({ onReturnToLogin }: AdminPasskeyStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleVerify = async () => {
    setStatus('loading');
    setErrorMessage('');

    try {
      const result = await requestAdminPasskeyVerification();
      if (result.verified) {
        window.location.href = '/admin';
        return;
      }
      setStatus('error');
      setErrorMessage('Passkey 验证失败');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Passkey 验证失败');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="space-y-4"
    >
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        需要 Passkey 验证以进入管理后台
      </div>

      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        请使用已注册的 Passkey 完成验证。
      </div>

      {status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {errorMessage}
        </div>
      )}

      <Button type="button" variant="primary" size="lg" loading={status === 'loading'} onClick={handleVerify} className="w-full">
        {status === 'loading' ? '验证中...' : '使用 Passkey 验证'}
      </Button>

      {onReturnToLogin && (
        <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">
          返回登录
        </Button>
      )}
    </motion.div>
  );
}
