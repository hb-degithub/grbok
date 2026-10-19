import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

type SourceState = 'ok' | 'stale' | 'unavailable' | 'unconfigured';

interface ProtectionStatus {
  now: string;
  safeline: {
    state: SourceState;
    updatedAt: string | null;
    windowHours: number;
    detected: number | null;
    blocked: number | null;
  };
  esa: { state: SourceState };
  challenge: { state: SourceState };
}

const SOURCE_DESC = [
  { key: 'esa', name: 'ESA 边缘', desc: '阿里云边缘加速与基础防护' },
  { key: 'safeline', name: '雷池 WAF', desc: '应用层攻击检测与拦截' },
  { key: 'app', name: '应用内防护', desc: '限流、校验与审核(代码层)' },
] as const;

// ESA 卡片在"未接入"时的补充说明(2026-09-18 实测:basic 版无公开统计 API)
const ESA_UNAVAILABLE_HINT = 'ESA 基础版无公开统计 API;开通日志服务(SLS)后可接入';

function stateBadge(state: SourceState) {
  switch (state) {
    case 'ok':
      return { text: '采集中', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
    case 'stale':
      return { text: '数据过期', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
    default:
      return { text: '统计未接入', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' };
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const diff = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  return `${Math.floor(diff / 3600)} 小时前`;
}

export default function ProtectionPanel() {
  const [data, setData] = useState<ProtectionStatus | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/protection', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const safeline = data?.safeline;
  const detectedCount = safeline?.detected ?? null;
  const blockedCount = safeline?.blocked ?? null;
  const hasNumbers = safeline != null && detectedCount !== null && blockedCount !== null;

  return (
    <section className="rounded-2xl border border-zinc-200/70 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">安全防护</h2>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">近 24 小时 · 每分钟汇总</span>
      </div>

      {/* 防护来源说明 */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SOURCE_DESC.map((s) => {
          const state: SourceState = s.key === 'esa' ? (data?.esa.state ?? 'unconfigured') : s.key === 'safeline' ? (safeline?.state ?? 'unavailable') : 'ok';
          const badge = stateBadge(state);
          return (
            <div key={s.key} className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{s.name}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', badge.cls)}>{badge.text}</span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-zinc-400 dark:text-zinc-500">{s.desc}</p>
              {s.key === 'esa' && state !== 'ok' && (
                <p className="mt-1 text-[10px] leading-4 text-zinc-400/80 dark:text-zinc-500/80">{ESA_UNAVAILABLE_HINT}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 雷池近 24h 真实汇总 */}
      <div className="mt-4">
        {error && (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            防护统计接口暂时不可用(不影响站点运行状态)。
          </p>
        )}
        {!error && !hasNumbers && (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            雷池拦截统计尚未接入或无数据——显示真实状态,不展示虚构数字。
          </p>
        )}
        {!error && hasNumbers && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
              <p className="font-mono text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{detectedCount}</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">检测记录</p>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
              <p className={cn('font-mono text-2xl font-bold tabular-nums', blockedCount > 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-50')}>
                {blockedCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">攻击拦截</p>
            </div>
          </div>
        )}
        {!error && hasNumbers && (
          <p className="mt-2 text-right text-[10px] text-zinc-400 dark:text-zinc-500">
            统计范围 hlydwz.com / img.hlydwz.com · 更新于 {formatRelative(safeline.updatedAt)}
            {safeline.state === 'stale' && <span className="ml-1 text-amber-500">(数据过期)</span>}
          </p>
        )}
      </div>
    </section>
  );
}
