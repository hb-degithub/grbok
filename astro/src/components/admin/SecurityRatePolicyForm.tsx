import React, { useEffect, useState } from 'react';
import { getRegistrationMode, getSecurityPolicies, putRegistrationMode, putSecurityPolicies, type PolicyDto } from '../../lib/admin-security-policy';
import { describePbError } from '../../lib/pb-error';
import { notifyStepUpExpired } from '../../lib/step-up-recovery';
export default function SecurityRatePolicyForm() {
  const [dto, setDto] = useState<PolicyDto | null>(null);
  const [mode, setMode] = useState<{mode:'open'|'invite_only';version:number}|null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => { Promise.all([getSecurityPolicies(), getRegistrationMode()]).then(([p,m]) => { setDto(p); setMode(m); }).catch(() => setStatus('无法读取安全策略')); }, []);
  if (!dto || !mode) return <div className="card rounded-xl p-5">{status || '正在加载安全策略…'}</div>;
  return <div className="card space-y-5 rounded-xl p-5">
    <div><h2 className="text-lg font-semibold">安全限额策略</h2><p className="text-xs text-muted">固定策略名；版本 {dto.version}</p></div>
    <div className="space-y-3">{Object.keys(dto.policies).map((key) => { const value=dto.policies[key]; const bound=dto.bounds[key]; return <div key={key} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem] items-center"><code className="text-xs">{key}</code><input aria-label={`${key} limit`} type="number" min={bound.minLimit} max={bound.maxLimit} value={value.limit} onChange={e=>setDto({...dto,policies:{...dto.policies,[key]:{...value,limit:Number(e.target.value)}}})} className="rounded border px-2 py-1"/><input aria-label={`${key} window`} type="number" min={bound.minWindow} max={bound.maxWindow} value={value.windowSeconds} onChange={e=>setDto({...dto,policies:{...dto.policies,[key]:{...value,windowSeconds:Number(e.target.value)}}})} className="rounded border px-2 py-1"/></div>; })}</div>
    <button className="rounded bg-indigo-600 px-4 py-2 text-white" onClick={async()=>{try{setDto(await putSecurityPolicies(dto));setStatus('策略已保存');}catch(err){if(notifyStepUpExpired(err)){setStatus('管理会话已过期，请重新验证动态口令');return;}setStatus(describePbError(err,'保存失败'));}}}>保存限额</button>
    <div className="border-t pt-4"><label className="flex items-center gap-3"><span>注册模式</span><select value={mode.mode} onChange={async e=>{try{setMode(await putRegistrationMode(e.target.value as 'open'|'invite_only',mode.version));setStatus('注册模式已保存');}catch(err){if(notifyStepUpExpired(err)){setStatus('管理会话已过期，请重新验证动态口令');return;}setStatus(describePbError(err,'注册模式保存失败'));}}} className="rounded border px-2 py-1"><option value="open">公开</option><option value="invite_only">仅邀请码</option></select></label></div>
    {status && <p role="status" className="text-sm text-muted">{status}</p>}
  </div>;
}
