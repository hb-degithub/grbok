import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

interface StatusMiniData {
  overall: 'operational' | 'outage' | 'unknown';
  services: { key: string; ok: boolean | null; avgLatency24h: number | null; uptime24h: number | null }[];
}

const OVERALL_TEXT: Record<string, string> = {
  operational: '运行正常',
  outage: '部分异常',
  unknown: '检测中',
};

/** 首页迷你运行状态卡:服务状态 + 24h 延迟均值 + 访客实测延迟,每 30s 刷新 */
export default function StatusMini() {
  const [status, setStatus] = useState<StatusMiniData | null>(null);
  const [userPing, setUserPing] = useState<number | null>(null);
  const [blocked24h, setBlocked24h] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('status failed');
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
    // 防护统计为可选增强:失败/未接入时静默不显示,不影响主状态
    try {
      const res = await fetch('/api/public/protection', { cache: 'no-store' });
      if (res.ok) {
        const p = await res.json();
        setBlocked24h(p?.safeline?.state === 'ok' && typeof p.safeline.blocked === 'number' ? p.safeline.blocked : null);
      }
    } catch {
      /* 防护统计不可用时忽略 */
    }
  }, []);

  const ping = useCallback(async () => {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      try {
        await fetch(`/api/public/ping?t=${Date.now()}`, { cache: 'no-store' });
        samples.push(performance.now() - start);
      } catch {
        // 忽略单次失败
      }
    }
    if (samples.length) setUserPing(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length));
  }, []);

  useEffect(() => {
    void load();
    void ping();
    const a = window.setInterval(() => void load(), 30_000);
    const b = window.setInterval(() => void ping(), 30_000);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, [load, ping]);

  // /api/public/status 在生产上可能返回 {overall:'unknown'} 或干脆不带 services，
  // 因此 services 必须可选访问；未知 overall 值统一回退 unknown 的检测中文案，
  // 不让标签渲染成空白（接口与文案本身不变）。
  const overall = status?.overall ?? 'unknown';
  const overallKey = overall === 'operational' || overall === 'outage' ? overall : 'unknown';
  const overallText = OVERALL_TEXT[overallKey];
  const site = status?.services?.find((s) => s.key === 'site') ?? undefined;

  return (
    <a
      href="/status"
      className="group block rounded-[2px] no-underline transition-transform hover:-translate-y-0.5"
      aria-label="查看完整运行状态页"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--sf-ink)]">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              overallKey === 'operational' && 'bg-[var(--sf-accent)]',
              overallKey === 'outage' && 'bg-[var(--sf-danger)]',
              overallKey === 'unknown' && 'bg-[var(--sf-ink-3)]',
            )}
          />
          {overallText}
        </span>
        <svg className="h-4 w-4 text-[var(--sf-ink-3)] transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-1 py-2">
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--sf-ink)]">
            {site?.avgLatency24h != null ? `${site.avgLatency24h}` : '—'}
            <span className="text-[10px] font-normal text-[var(--sf-ink-3)]">ms</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--sf-ink-3)]">24h 延迟</p>
        </div>
        <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-1 py-2">
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--sf-ink)]">
            {site?.uptime24h != null ? `${site.uptime24h}` : '—'}
            <span className="text-[10px] font-normal text-[var(--sf-ink-3)]">%</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--sf-ink-3)]">24h 可用率</p>
        </div>
        <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-1 py-2">
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--sf-accent)]">
            {userPing != null ? `${userPing}` : '—'}
            <span className="text-[10px] font-normal text-[var(--sf-ink-3)]">ms</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--sf-ink-3)]">你的延迟</p>
        </div>
      </div>
      {blocked24h !== null && (
        <p className="mt-3 flex items-center justify-between rounded-[2px] border border-[var(--sf-line-soft)] px-3 py-2 text-[11px] text-[var(--sf-ink-2)]">
          <span>24h 攻击拦截</span>
          <span className="font-mono font-bold tabular-nums text-[var(--sf-danger)]">{blocked24h} 次</span>
        </p>
      )}
    </a>
  );
}
