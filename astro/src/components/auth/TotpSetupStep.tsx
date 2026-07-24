import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import QRCode from 'qrcode';
import { confirmAdminTotpSetup, startAdminTotpSetup } from '../../lib/admin-totp';
import { saveAdminRecoveryCode } from '../../lib/admin-step-up';
import Button from '../ui/Button';

interface TotpSetupStepProps {
  onReturnToLogin?: () => void;
  mode?: 'setup' | 'recovery';
}

export default function TotpSetupStep({ onReturnToLogin, mode = 'setup' }: TotpSetupStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [uri, setUri] = useState('');
  const [base32, setBase32] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    startAdminTotpSetup()
      .then((result) => {
        if (cancelled) return;
        setUri(result.uri);
        setBase32(result.base32);
        if (canvasRef.current) {
          QRCode.toCanvas(canvasRef.current, result.uri, { width: 200, margin: 1 });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : '初始化绑定失败');
      });
    return () => { cancelled = true; };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(base32);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handleConfirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setStatus('error');
      setErrorMessage('请输入 6 位动态码');
      return;
    }
    setStatus('loading');
    setErrorMessage('');
    try {
      const result = await confirmAdminTotpSetup(code.trim());
      if (result.verified) { window.location.href = '/admin'; return; }
      throw new Error('动态码校验失败');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : '动态码校验失败');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        {mode === 'recovery' ? '使用恢复码重新绑定身份验证器' : '首次进入需绑定身份验证器（TOTP）'}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
        <li>用 Google Authenticator / 微软 Authenticator / 1Password 扫描二维码</li>
        <li>或手动输入下方密钥</li>
        <li>输入 App 显示的 6 位动态码完成绑定</li>
      </ol>
      <div className="flex justify-center rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700">
        <canvas ref={canvasRef} aria-label="TOTP 绑定二维码" />
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <code className="flex-1 select-all break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{base32 || '生成中…'}</code>
        <button type="button" onClick={handleCopy} className="shrink-0 rounded-md px-2 py-1 text-xs text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <label className="block text-sm text-zinc-600 dark:text-zinc-300">
        6 位动态码
        <input
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-center font-mono text-lg tracking-[0.5em] dark:border-zinc-600"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
        />
      </label>
      {status === 'error' && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{errorMessage}</div>}
      <Button type="button" variant="primary" size="lg" loading={status === 'loading'} onClick={handleConfirm} className="w-full" disabled={!base32}>
        {status === 'loading' ? '校验中…' : '完成绑定'}
      </Button>
      {onReturnToLogin && <Button type="button" variant="ghost" onClick={onReturnToLogin} className="w-full">返回登录</Button>}
    </motion.div>
  );
}

// 恢复码入口：verify 界面凭据全丢时使用
export function saveRecoveryAndReload(code: string): void {
  saveAdminRecoveryCode(code);
  window.location.reload();
}
