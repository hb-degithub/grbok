import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { drawQrToCanvas } from '../../lib/qr-canvas';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { fetchAdminVerificationStatus, revokeAdminTotp, startAdminTotpSetup, confirmAdminTotpSetup } from '../../lib/admin-totp';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function TotpManager() {
  const { user } = useAdminAuth();
  const [bound, setBound] = useState<boolean | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  // 重新绑定流程
  const [rebindUri, setRebindUri] = useState('');
  const [rebindBase32, setRebindBase32] = useState('');
  const [rebindCode, setRebindCode] = useState('');
  const [isRebinding, setIsRebinding] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSuperAdmin = user?.role === 'super_admin';

  const loadStatus = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await fetchAdminVerificationStatus();
      setBound(result.status !== 'totp_setup_required');
      setExpiresAt(result.expiresAt || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载状态失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isSuperAdmin) void loadStatus(); }, [isSuperAdmin]);

  const handleStartRebind = async () => {
    setError('');
    try {
      const result = await startAdminTotpSetup();
      setRebindUri(result.uri);
      setRebindBase32(result.base32);
      if (canvasRef.current) {
        drawQrToCanvas(canvasRef.current, result.uri, 180);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化重新绑定失败');
    }
  };

  const handleConfirmRebind = async () => {
    if (!/^\d{6}$/.test(rebindCode.trim())) { setError('请输入 6 位动态码'); return; }
    setIsRebinding(true);
    setError('');
    try {
      await confirmAdminTotpSetup(rebindCode.trim());
      setRebindUri('');
      setRebindBase32('');
      setRebindCode('');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '动态码校验失败');
    } finally {
      setIsRebinding(false);
    }
  };

  const handleRevoke = async () => {
    setError('');
    try {
      await revokeAdminTotp();
      setConfirmRevoke(false);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '吊销失败');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rebindBase32);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  if (!isSuperAdmin) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card rounded-xl p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text">身份验证器（TOTP）</h2>
        <p className="text-sm text-text-secondary">管理后台二次验证使用 Authenticator App 6 位动态码。</p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-zinc-500" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
            <div>
              <p className="text-sm font-medium text-text">{bound ? '已绑定' : '未绑定'}</p>
              {bound && expiresAt && <p className="text-xs text-muted">当前验证有效期至 {new Date(expiresAt).toLocaleString('zh-CN')}</p>}
            </div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bound ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
              {bound ? '启用中' : '待绑定'}
            </span>
          </div>

          {bound && !rebindUri && (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={handleStartRebind}>重新绑定</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(true)} className="text-red-600 hover:text-red-700 dark:text-red-400">吊销绑定</Button>
            </div>
          )}

          {rebindUri && (
            <div className="space-y-3 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
              <p className="text-sm text-text">用 Authenticator App 扫描新二维码，输入动态码完成重新绑定：</p>
              <div className="flex justify-center rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700">
                <canvas ref={canvasRef} aria-label="TOTP 重新绑定二维码" />
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                <code className="flex-1 select-all break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{rebindBase32}</code>
                <button type="button" onClick={handleCopy} className="shrink-0 rounded-md px-2 py-1 text-xs text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40">
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-center font-mono tracking-[0.3em] dark:border-zinc-600"
                  value={rebindCode}
                  onChange={(event) => setRebindCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                />
                <Button onClick={handleConfirmRebind} loading={isRebinding} disabled={isRebinding}>确认</Button>
                <Button variant="ghost" onClick={() => { setRebindUri(''); setRebindBase32(''); setRebindCode(''); }}>取消</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRevoke}
        title="吊销身份验证器绑定？"
        message="吊销后所有已签发的后台验证会话将立即失效，下次进入后台需要重新绑定。"
        confirmLabel="吊销"
        danger
        onConfirm={handleRevoke}
        onCancel={() => setConfirmRevoke(false)}
      />
    </motion.div>
  );
}
