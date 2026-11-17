import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { drawQrToCanvas } from '../../lib/qr-canvas';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { fetchAdminVerificationStatus, revokeAdminTotp, startAdminTotpSetup, confirmAdminTotpSetup } from '../../lib/admin-totp';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

/* 身份验证器（TOTP）管理（科幻简约 · 批次 C5）
   面板 surface 底 + 冷灰细线 + 3px 圆角；状态徽标为细线 chip（已绑定 emerald / 待绑定 amber）；
   重新绑定面板用唯一强调色细线；二维码画布保持原样（drawQrToCanvas 自带白底）。
   状态读取、开始/确认重绑、吊销、复制恢复码与 6 位动态码清洗全部不变。 */

const CHIP = 'inline-flex shrink-0 items-center rounded-[2px] border px-2 py-0.5 font-mono text-[10px] leading-none tracking-[0.08em]';
const TONE = {
  success: 'border-emerald-600/45 text-emerald-700 dark:border-emerald-400/45 dark:text-emerald-300',
  warning: 'border-amber-600/45 text-amber-700 dark:border-amber-400/45 dark:text-amber-300',
} as const;

const CODE_INPUT =
  'min-h-10 min-w-0 flex-1 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-center font-mono text-[16px] tracking-[0.3em] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]';

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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
      <div className="border-b border-[var(--sf-line)] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">身份验证器（TOTP）</h2>
          <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">2FA / TOTP</span>
        </div>
        <p className="mt-1 break-words text-xs leading-5 text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">管理后台二次验证使用 Authenticator App 6 位动态码。</p>
      </div>

      <div className="p-4 sm:p-5">
        {error && <div role="alert" className="mb-4 rounded-[3px] border border-[var(--sf-danger)] px-4 py-3 text-sm text-[var(--sf-danger)] [overflow-wrap:anywhere]">{error}</div>}

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--sf-line)] border-t-[var(--sf-accent)]" aria-hidden="true" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--sf-ink)]">{bound ? '已绑定' : '未绑定'}</p>
                {bound && expiresAt && <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">当前验证有效期至 {new Date(expiresAt).toLocaleString('zh-CN')}</p>}
              </div>
              <span className={`${CHIP} ${bound ? TONE.success : TONE.warning}`}>
                {bound ? '启用中' : '待绑定'}
              </span>
            </div>

            {bound && !rebindUri && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleStartRebind}>重新绑定</Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(true)} className="text-[var(--sf-danger)] hover:text-[var(--sf-danger)]">吊销绑定</Button>
              </div>
            )}

            {rebindUri && (
              <div className="space-y-3 rounded-[3px] border border-[var(--sf-accent)] p-4">
                <p className="break-words text-sm text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">用 Authenticator App 扫描新二维码，输入动态码完成重新绑定：</p>
                <div className="flex justify-center rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-3">
                  <canvas ref={canvasRef} aria-label="TOTP 重新绑定二维码" />
                </div>
                <div className="flex items-center gap-2 rounded-[3px] border border-[var(--sf-line)] px-3 py-2">
                  <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-[var(--sf-ink-2)]">{rebindBase32}</code>
                  <button type="button" onClick={handleCopy} className="shrink-0 rounded-[3px] border border-transparent px-2 py-1 text-xs text-[var(--sf-accent)] transition-colors hover:border-[var(--sf-line)] hover:bg-[var(--sf-line-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]">
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={CODE_INPUT}
                    value={rebindCode}
                    onChange={(event) => setRebindCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                    aria-label="6 位动态码"
                  />
                  <Button onClick={handleConfirmRebind} loading={isRebinding} disabled={isRebinding}>确认</Button>
                  <Button variant="ghost" onClick={() => { setRebindUri(''); setRebindBase32(''); setRebindCode(''); }}>取消</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
