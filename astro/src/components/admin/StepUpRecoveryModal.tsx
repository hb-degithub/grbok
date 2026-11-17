import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { verifyAdminTotp, describeTotpError } from '../../lib/admin-totp';
import { onStepUpRequired } from '../../lib/step-up-recovery';
import { showToast } from '../ui/Toast';

/* step-up 内联重验模态（科幻简约 · 批次 C5）
   遮罩走 --sf-scrim，面板实底 surface + 冷灰细线 + 3px 圆角；输入与 ui/Input.tsx 同一套。
   6 位动态码的清洗（replace(/\D/g,'').slice(0,6)）、Enter 提交、错误文案、Toast、
   verified 判定与 dialog 语义全部原样保留。 */

const BTN_BASE =
  'inline-flex items-center justify-center rounded-[3px] border px-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY = 'min-h-10 border-[var(--sf-accent)] bg-[var(--sf-accent)] text-xs text-[var(--sf-on-accent)] hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)]';
const BTN_GHOST = 'min-h-10 border-transparent bg-transparent text-xs text-[var(--sf-ink-2)] hover:border-[var(--sf-line)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)]';

/**
 * step-up 内联重验模态
 *
 * 常驻 AdminGuard 内。任何后台写操作被 403 ADMIN_STEP_UP_REQUIRED 拒绝时，
 * 通过 step-up-recovery 事件触发本模态；验证成功后新凭证已存入 sessionStorage，
 * 用户点"重试"即可在原页面重放失败操作，无需刷新。
 */
export default function StepUpRecoveryModal() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => onStepUpRequired(() => {
    setCode('');
    setStatus('idle');
    setErrorMessage('');
    setOpen(true);
  }), []);

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
      if (!result.verified) throw new Error('TOTP_CODE_INVALID');
      setOpen(false);
      showToast('验证成功，请重试刚才的操作', 'success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(describeTotpError(err, '动态码校验失败'));
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--sf-scrim)] p-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6"
            role="dialog" aria-modal="true" aria-label="重新验证动态口令"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--sf-ink-3)]">Step-up / Re-auth</span>
              <span className="h-px flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
            </div>
            <h2 className="font-display text-lg font-bold tracking-tight text-[var(--sf-ink)]">管理会话已过期</h2>
            <p className="mt-2 text-sm text-[var(--sf-ink-2)]">
              刚才的操作被拒绝。请输入身份验证器当前显示的 6 位动态码，验证成功后重试即可，不会丢失已填写的内容。
            </p>
            <input
              className="mt-4 min-h-11 w-full rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-3 py-2 text-center font-mono text-lg tracking-[0.5em] text-[var(--sf-ink)] outline-none transition-colors placeholder:text-[var(--sf-ink-3)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
              aria-label="6 位动态码"
            />
            {status === 'error' && (
              <div role="alert" className="mt-3 rounded-[3px] border border-[var(--sf-danger)] px-3 py-2 text-sm text-[var(--sf-danger)]">{errorMessage}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className={BTN_BASE + ' ' + BTN_GHOST}>稍后</button>
              <button onClick={handleVerify} disabled={status === 'loading'} className={BTN_BASE + ' ' + BTN_PRIMARY}>
                {status === 'loading' ? '验证中…' : '验证'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
