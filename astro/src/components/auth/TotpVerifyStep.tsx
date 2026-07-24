import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { verifyAdminTotp } from '../../lib/admin-totp';
import { saveAdminRecoveryCode } from '../../lib/admin-step-up';
import Button from '../ui/Button';

interface TotpVerifyStepProps {
  onReturnToLogin?: () => void;
}

export default function TotpVerifyStep({ onReturnToLogin }: TotpVerifyStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setStatus('error');
      setErrorMessage('请输入 6 位动态码');
      return;
    }
    setStatus('loading');
    setErrorMessage('');
    try {
      const result = await verifyAdminTotp(code.trim());
      if (result.verified) { window.location.href = '/admin'; return; }
      throw new Error('动态码校验失败');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '动态码校验失败');
    }
  };

  const handleRecovery = () => {
    if (!recoveryCode.trim()) {
      setStatus('error');
      setErrorMessage('请输入恢复码');
      return;
    }
    saveAdminRecoveryCode(recoveryCode.trim());
    window.location.reload();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        需要身份验证器动态码以进入管理后台
      </div>
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        打开你的 Authenticator App，输入当前显示的 6 位动态码。
      </div>
      <label className="block text-sm text-zinc-600 dark:text-zinc-300">
        6 位动态码
        <input
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-center font-mono text-lg tracking-[0.5em] dark:border-zinc-600"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(event) => { if (event.key === 'Enter') handleVerify(); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          autoFocus
        />
      </label>
      {status === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{errorMessage}</div>}
      <Button type="button" variant="primary" size="lg" loading={status === 'loading'} onClick={handleVerify} className="w-full">
        {status === 'loading' ? '验证中…' : '验证'}
      </Button>
      <button
        type="button"
        onClick={() => setShowRecovery((v) => !v)}
        className="w-full text-center text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        身份验证器不可用？使用恢复码
      </button>
      {showRecovery && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-xs text-amber-800 dark:text-amber-200">仅凭据全部丢失时使用：输入宿主机脚本显示的一次性恢复码，将引导你重新绑定。</p>
          <input
            className="w-full rounded-lg border border-amber-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-amber-700"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            placeholder="一次性恢复码"
            autoComplete="off"
          />
          <Button type="button" variant="ghost" size="sm" onClick={handleRecovery} className="w-full">使用恢复码</Button>
        </div>
      )}
      {onReturnToLogin && <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">返回登录</Button>}
    </motion.div>
  );
}
