import React, { useEffect, useState } from 'react';
import { getRegistrationMode, getSecurityPolicies, putRegistrationMode, putSecurityPolicies, type PolicyDto } from '../../lib/admin-security-policy';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';

/* 输入框规格与 astro/src/components/ui/Input.tsx 保持一致：
   表面色底 + 控制线描边，聚焦换成唯一强调色；数字列等宽对齐。 */
const INPUT_BASE =
  'min-h-[40px] min-w-0 rounded-[3px] border border-[var(--sf-line-control)] bg-[var(--sf-surface)] px-2.5 text-[16px] tabular-nums text-[var(--sf-ink)] outline-none transition-colors duration-200 focus-visible:border-[var(--sf-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] sm:text-sm';
const BTN_PRIMARY =
  'inline-flex min-h-9 items-center justify-center rounded-[3px] border border-[var(--sf-accent)] bg-[var(--sf-accent)] px-3 text-[13px] font-medium text-[var(--sf-on-accent)] transition-colors hover:border-[var(--sf-accent-ink)] hover:bg-[var(--sf-accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]';

export default function SecurityRatePolicyForm() {
  const [dto, setDto] = useState<PolicyDto | null>(null);
  const [mode, setMode] = useState<{mode:'open'|'invite_only';version:number}|null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => { Promise.all([getSecurityPolicies(), getRegistrationMode()]).then(([p,m]) => { setDto(p); setMode(m); }).catch(() => setStatus('无法读取安全策略')); }, []);
  if (!dto || !mode) return (
    <div className="min-w-0 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4">
      <p role="status" className="text-sm text-[var(--sf-ink-2)]">{status || '正在加载安全策略…'}</p>
    </div>
  );
  return (
    <section className="min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2">
        <h2 className="text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]">安全限额策略</h2>
        <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
        <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--sf-ink-3)]">V{dto.version}</span>
      </div>

      <div className="space-y-3 p-3">
        <p className="text-[11px] leading-relaxed text-[var(--sf-ink-3)]">固定策略名；版本 {dto.version}</p>

        <div className="hidden grid-cols-[1fr_8rem_8rem] gap-2 border-b border-[var(--sf-line)] pb-1 sm:grid">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">策略</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">次数上限</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">窗口（秒）</span>
        </div>

        <div className="space-y-2">
          {Object.keys(dto.policies).map((key) => {
            const value = dto.policies[key];
            const bound = dto.bounds[key];
            return (
              <div key={key} className="grid items-center gap-2 border-b border-[var(--sf-line-soft)] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_8rem_8rem]">
                <code className="min-w-0 break-all font-mono text-xs text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{key}</code>
                <input
                  aria-label={`${key} limit`}
                  type="number"
                  min={bound.minLimit}
                  max={bound.maxLimit}
                  value={value.limit}
                  onChange={e=>setDto({...dto,policies:{...dto.policies,[key]:{...value,limit:Number(e.target.value)}}})}
                  className={`${INPUT_BASE} w-full`}
                />
                <input
                  aria-label={`${key} window`}
                  type="number"
                  min={bound.minWindow}
                  max={bound.maxWindow}
                  value={value.windowSeconds}
                  onChange={e=>setDto({...dto,policies:{...dto.policies,[key]:{...value,windowSeconds:Number(e.target.value)}}})}
                  className={`${INPUT_BASE} w-full`}
                />
              </div>
            );
          })}
        </div>

        <div className="pt-1">
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={async()=>{try{setDto(await putSecurityPolicies(dto));setStatus('策略已保存');}catch(err){if(notifyStepUpExpired(err)){setStatus('管理会话已过期，请重新验证动态口令');return;}setStatus(describePbError(err,'保存失败'));}}}
          >
            保存限额
          </button>
        </div>

        <div className="border-t border-[var(--sf-line)] pt-3">
          <label className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-[var(--sf-ink-2)]">注册模式</span>
            <select
              value={mode.mode}
              onChange={async e=>{try{setMode(await putRegistrationMode(e.target.value as 'open'|'invite_only',mode.version));setStatus('注册模式已保存');}catch(err){if(notifyStepUpExpired(err)){setStatus('管理会话已过期，请重新验证动态口令');return;}setStatus(describePbError(err,'注册模式保存失败'));}}}
              className={`${INPUT_BASE} w-auto`}
            >
              <option value="open">公开</option>
              <option value="invite_only">仅邀请码</option>
            </select>
          </label>
        </div>

        {status && <p role="status" className="text-sm text-[var(--sf-ink-2)]">{status}</p>}
      </div>
    </section>
  );
}
