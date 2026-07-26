import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { verifyAdminTotp, describeTotpError } from '../../lib/admin-totp';
import { onStepUpRequired } from '../../lib/step-up-recovery';
import { showToast } from '../ui/Toast';

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
          className="glass-overlay fixed inset-0 z-[80] flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="card w-full max-w-sm rounded-xl p-6"
            role="dialog" aria-modal="true" aria-label="重新验证动态口令"
          >
            <h2 className="font-display text-lg font-bold text-text">管理会话已过期</h2>
            <p className="mt-2 text-sm text-text-secondary">
              刚才的操作被拒绝。请输入身份验证器当前显示的 6 位动态码，验证成功后重试即可，不会丢失已填写的内容。
            </p>
            <input
              className="mt-4 min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-center font-mono text-lg tracking-[0.5em] text-text outline-none focus:border-accent"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
            />
            {status === 'error' && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errorMessage}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn-ghost min-h-10 text-xs">稍后</button>
              <button onClick={handleVerify} disabled={status === 'loading'} className="btn-primary min-h-10 text-xs">
                {status === 'loading' ? '验证中…' : '验证'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
