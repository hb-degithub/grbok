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

/**
 * 采集状态徽标：采集中 = 强调色，数据过期 = amber（降级语义），
 * 统计未接入 = 次级文字色（未知语义）。
 */
function stateBadge(state: SourceState) {
  switch (state) {
    case 'ok':
      return { text: '采集中', cls: 'border-[var(--sf-accent)] text-[var(--sf-accent-ink)]' };
    case 'stale':
      return { text: '数据过期', cls: 'border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-400' };
    default:
      return { text: '统计未接入', cls: 'border-[var(--sf-line)] text-[var(--sf-ink-3)]' };
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
  // 首次请求尚未结束时为 true：加载中不能显示成「尚未接入」。
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/protection', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
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
    <section className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">
          PROTECT / 03
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">安全防护</h2>
        <span className="ml-auto font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">
          近 24 小时 · 每分钟汇总
        </span>
      </div>

      {/* 防护来源说明 */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SOURCE_DESC.map((s) => {
          const state: SourceState = s.key === 'esa' ? (data?.esa.state ?? 'unconfigured') : s.key === 'safeline' ? (safeline?.state ?? 'unavailable') : 'ok';
          const badge = stateBadge(state);
          return (
            <div
              key={s.key}
              className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--sf-ink-2)]">{s.name}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em]',
                    badge.cls,
                  )}
                >
                  {badge.text}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-[var(--sf-ink-3)]">{s.desc}</p>
              {s.key === 'esa' && state !== 'ok' && (
                <p className="mt-1 text-[10px] leading-4 text-[var(--sf-ink-3)]">{ESA_UNAVAILABLE_HINT}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 雷池近 24h 真实汇总：加载 / 失败 / 空 / 数据四态可区分 */}
      <div className="mt-4">
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-canvas)] px-4 py-3"
          >
            <p className="text-xs leading-5 text-[var(--sf-ink-2)]">
              防护统计接口暂时不可用(不影响站点运行状态)。{hasNumbers ? '下方为上一次成功获取的数据。' : ''}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-[3px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
            >
              重试防护统计
            </button>
          </div>
        )}
        {!error && data === null && loading && (
          <p
            data-state="loading"
            className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-4 py-3 font-mono text-[11px] leading-6 tracking-[0.04em] text-[var(--sf-ink-3)]"
          >
            防护统计加载中…
          </p>
        )}
        {!error && data !== null && !hasNumbers && (
          <p
            data-state="empty"
            className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-4 py-3 text-xs leading-5 text-[var(--sf-ink-3)]"
          >
            雷池拦截统计尚未接入或无数据——显示真实状态,不展示虚构数字。
          </p>
        )}
        {hasNumbers && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-4 text-center">
              <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--sf-ink)]">{detectedCount}</p>
              <p className="mt-1 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">检测记录</p>
            </div>
            <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] p-4 text-center">
              <p
                className={cn(
                  'font-mono text-2xl font-semibold tabular-nums',
                  blockedCount > 0 ? 'text-[var(--sf-danger)]' : 'text-[var(--sf-ink)]',
                )}
              >
                {blockedCount}
              </p>
              <p className="mt-1 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">攻击拦截</p>
            </div>
          </div>
        )}
        {hasNumbers && (
          <p className="mt-2 text-right font-mono text-[10px] tracking-[0.04em] text-[var(--sf-ink-3)]">
            统计范围 hlydwz.com / img.hlydwz.com · 更新于 {formatRelative(safeline.updatedAt)}
            {safeline.state === 'stale' && <span className="ml-1 text-amber-700 dark:text-amber-400">(数据过期)</span>}
          </p>
        )}
      </div>
    </section>
  );
}
