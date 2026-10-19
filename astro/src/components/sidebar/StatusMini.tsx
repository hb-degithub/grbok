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

  const overall = status?.overall ?? 'unknown';
  const site = status?.services.find((s) => s.key === 'site');

  return (
    <a
      href="/status"
      className="group block rounded-lg no-underline transition-transform hover:-translate-y-0.5"
      aria-label="查看完整运行状态页"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              overall === 'operational' && 'bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.6)]',
              overall === 'outage' && 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.6)]',
              overall === 'unknown' && 'bg-zinc-400',
            )}
          />
          {OVERALL_TEXT[overall]}
        </span>
        <svg className="h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-1 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-50 px-1 py-2 dark:bg-zinc-950/50">
          <p className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {site?.avgLatency24h != null ? `${site.avgLatency24h}` : '—'}
            <span className="text-[10px] font-normal text-zinc-400">ms</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">24h 延迟</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-1 py-2 dark:bg-zinc-950/50">
          <p className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {site?.uptime24h != null ? `${site.uptime24h}` : '—'}
            <span className="text-[10px] font-normal text-zinc-400">%</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">24h 可用率</p>
        </div>
        <div className="rounded-lg bg-zinc-50 px-1 py-2 dark:bg-zinc-950/50">
          <p className="font-mono text-sm font-bold tabular-nums text-teal-600 dark:text-teal-300">
            {userPing != null ? `${userPing}` : '—'}
            <span className="text-[10px] font-normal text-zinc-400">ms</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">你的延迟</p>
        </div>
      </div>
      {blocked24h !== null && (
        <p className="mt-3 flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:bg-zinc-950/50 dark:text-zinc-400">
          <span>24h 攻击拦截</span>
          <span className="font-mono font-bold tabular-nums text-red-500 dark:text-red-400">{blocked24h} 次</span>
        </p>
      )}
    </a>
  );
}
