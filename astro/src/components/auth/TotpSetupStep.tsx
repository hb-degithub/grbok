import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { drawQrToCanvas } from '../../lib/qr-canvas';
import { describeTotpError, confirmAdminTotpSetup, startAdminTotpSetup } from '../../lib/admin-totp';
import { saveAdminRecoveryCode } from '../../lib/admin-step-up';
import Button from '../ui/Button';

interface TotpSetupStepProps {
  onReturnToLogin?: () => void;
  mode?: 'setup' | 'recovery';
}

export default function TotpSetupStep({ onReturnToLogin, mode = 'setup' }: TotpSetupStepProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [base32, setBase32] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    startAdminTotpSetup()
      .then((result) => {
        if (cancelled) return;
        setBase32(result.base32);
        if (canvasRef.current) {
          drawQrToCanvas(canvasRef.current, result.uri, 200);
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
      setErrorMessage(describeTotpError(err, '动态码校验失败'));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-4">
      <div className="rounded-[3px] border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        {mode === 'recovery' ? '使用恢复码重新绑定身份验证器' : '首次进入需绑定身份验证器（TOTP）'}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--sf-ink-2)]">
        <li>用 Google Authenticator / 微软 Authenticator / 1Password 扫描二维码</li>
        <li>或手动输入下方密钥</li>
        <li>输入 App 显示的 6 位动态码完成绑定</li>
      </ol>
      <div className="flex justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4">
        <canvas ref={canvasRef} aria-label="TOTP 绑定二维码" />
      </div>
      <div className="flex items-center gap-2 rounded-[3px] border border-[var(--sf-line-control)] px-3 py-2">
        <code className="flex-1 select-all break-all font-mono text-xs text-[var(--sf-ink-2)]">{base32 || '生成中…'}</code>
        <button type="button" onClick={handleCopy} className="shrink-0 rounded-[2px] px-2 py-1 text-xs text-[var(--sf-accent)] transition-colors hover:bg-[var(--sf-line-soft)]">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <label className="block text-sm text-[var(--sf-ink-2)]">
        6 位动态码
        <input
          className="mt-2 w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-center font-mono text-lg tracking-[0.5em] text-[var(--sf-ink)]"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
        />
      </label>
      {status === 'error' && <div className="rounded-[3px] border border-red-300 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{errorMessage}</div>}
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
