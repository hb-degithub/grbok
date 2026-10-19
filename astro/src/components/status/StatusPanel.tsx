import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface SamplePoint {
  t: string;
  ok: boolean;
  ms: number;
}

interface ServiceStatus {
  key: string;
  label: string;
  ok: boolean | null;
  latencyMs: number | null;
  lastCheck: string | null;
  uptime24h: number | null;
  avgLatency24h: number | null;
  recent: SamplePoint[];
}

interface PublicStatus {
  now: string;
  overall: 'operational' | 'outage' | 'unknown';
  services: ServiceStatus[];
  host: HostSnapshot | null;
}

interface HostSnapshot {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  rxKbps: number;
  txKbps: number;
  load1: number;
  cpuCores: number | null;
  memTotalMb: number | null;
  at: string;
}

/** 从 ESA 的 via 响应头解析边缘节点编号(如 ens-cache6.jp14 → JP14) */
function parseEdgeNode(via: string | null): string | null {
  if (!via) return null;
  const m = via.match(/ens-cache\d+\.([a-z0-9-]+)/i);
  return m ? m[1].toUpperCase() : null;
}

// 已验证的 ESA 节点编号 → 地域(见到的再补充,未知编号原样展示)
const EDGE_REGIONS: Record<string, string> = {
  JP14: '日本(东京)',
};

const STATUS_REFRESH_MS = 30_000;
const PING_INTERVAL_MS = 15_000;
const PING_COUNT = 5;
const PING_HISTORY = 30;

function statusDot(ok: boolean | null) {
  if (ok === true) return 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]';
  if (ok === false) return 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.15)]';
  return 'bg-zinc-400 shadow-[0_0_0_4px_rgba(113,113,122,0.15)]';
}

function statusText(ok: boolean | null) {
  if (ok === true) return '正常';
  if (ok === false) return '异常';
  return '未知';
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const at = Date.parse(iso.replace(' ', 'T'));
  if (!Number.isFinite(at)) return '—';
  const diff = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff} 秒前`;
  return `${Math.floor(diff / 60)} 分钟前`;
}

/** 最近 60 个采样点的可用率色条 */
function UptimeBars({ recent }: { recent: SamplePoint[] }) {
  if (!recent.length) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-500">采样数据积累中…</p>;
  }
  return (
    <div className="flex h-8 items-end gap-[2px]" role="img" aria-label="最近采样可用率">
      {recent.map((s, i) => (
        <span
          key={`${s.t}-${i}`}
          title={`${new Date(s.t.replace(' ', 'T')).toLocaleTimeString()} · ${s.ok ? '正常' : '异常'} · ${s.ms}ms`}
          className={cn(
            'w-full min-w-[2px] flex-1 rounded-sm transition-colors',
            s.ok ? 'bg-emerald-500/80 hover:bg-emerald-500' : 'bg-red-500 hover:bg-red-400',
          )}
          style={{ height: `${Math.max(25, Math.min(100, (s.ms / 400) * 100))}%` }}
        />
      ))}
    </div>
  );
}

/** 用户端实测延迟迷你走势 */
function PingSparkline({ pings }: { pings: number[] }) {
  if (pings.length < 2) return null;
  const max = Math.max(...pings, 50);
  const w = 120;
  const h = 32;
  const points = pings
    .map((v, i) => `${(i / (pings.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full text-teal-500 dark:text-teal-400" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Gauge({ label, value, unit = '%' }: { label: string; value: number | null; unit?: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  const tone = value === null ? 'bg-zinc-300 dark:bg-zinc-700' : pct >= 85 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-teal-500';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
          {value === null ? '—' : `${value}${unit}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={cn('h-full rounded-full transition-all duration-700', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatKbps(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  return `${v} KB/s`;
}

export default function StatusPanel() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [pings, setPings] = useState<number[]>([]);
  const [staticMs, setStaticMs] = useState<number | null>(null);
  const [edgeNode, setEdgeNode] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const timerRef = useRef<number[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/public/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('status failed');
      setStatus(await res.json());
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }, []);

  const runPing = useCallback(async () => {
    if (pinging) return;
    setPinging(true);
    try {
      // 动态:回源 API 心跳
      const batch: number[] = [];
      for (let i = 0; i < PING_COUNT; i++) {
        const start = performance.now();
        try {
          const res = await fetch(`/api/public/ping?t=${Date.now()}`, { cache: 'no-store' });
          const node = parseEdgeNode(res.headers.get('via'));
          if (node) setEdgeNode(node);
          batch.push(Math.round(performance.now() - start));
        } catch {
          // 单次失败跳过,不影响其余样本
        }
      }
      if (batch.length) {
        const avg = Math.round(batch.reduce((a, b) => a + b, 0) / batch.length);
        setPings((prev) => [...prev.slice(-(PING_HISTORY - 1)), avg]);
      }
      // 静态:CDN 缓存的小图标(测边缘命中速度;URL 固定以命中缓存)
      try {
        const sStart = performance.now();
        await fetch('/favicon.svg', { cache: 'force-cache' });
        setStaticMs(Math.round(performance.now() - sStart));
      } catch {
        /* 静态探测失败不影响主流程 */
      }
    } finally {
      setPinging(false);
    }
  }, [pinging]);

  useEffect(() => {
    void loadStatus();
    void runPing();
    const statusTimer = window.setInterval(() => void loadStatus(), STATUS_REFRESH_MS);
    const pingTimer = window.setInterval(() => void runPing(), PING_INTERVAL_MS);
    timerRef.current = [statusTimer, pingTimer];
    return () => timerRef.current.forEach((t) => window.clearInterval(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overall = statusError ? 'unknown' : status?.overall ?? 'unknown';
  const currentPing = pings.length ? pings[pings.length - 1] : null;
  const minPing = pings.length ? Math.min(...pings) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 总览横幅 */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border px-5 py-4',
          overall === 'operational' && 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/30',
          overall === 'outage' && 'border-red-200 bg-red-50/60 dark:border-red-800/50 dark:bg-red-950/30',
          overall === 'unknown' && 'border-zinc-200 bg-zinc-50/60 dark:border-zinc-700/50 dark:bg-zinc-900/40',
        )}
        role="status"
      >
        <span className={cn('h-3 w-3 shrink-0 rounded-full', overall === 'operational' ? 'bg-emerald-500' : overall === 'outage' ? 'bg-red-500' : 'bg-zinc-400')} />
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
          {overall === 'operational' && '所有系统运行正常'}
          {overall === 'outage' && '部分服务异常,正在处理'}
          {overall === 'unknown' && (statusError ? '状态接口暂时不可用' : '状态加载中…')}
        </p>
        {status?.now && (
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
            更新于 {formatRelative(status.now)} · 每 30 秒自动刷新
          </span>
        )}
      </div>

      {/* 用户到服务器延迟(本机实测) */}
      <section className="rounded-2xl border border-zinc-200/70 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">你到本站的延迟</h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">浏览器实测 · 每 15 秒探测 {PING_COUNT} 次取均值</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-3xl font-bold tabular-nums text-teal-600 dark:text-teal-300">
              {currentPing !== null ? `${currentPing}` : '—'}
              <span className="ml-1 text-sm font-normal text-zinc-400">ms</span>
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">动态接口(回源)</p>
          </div>
          <div>
            <p className="font-mono text-xl font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
              {staticMs !== null ? `${staticMs}` : '—'}
              <span className="ml-1 text-xs font-normal text-zinc-400">ms</span>
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">静态资源(CDN 边缘)</p>
          </div>
          <div>
            <p className="font-mono text-xl font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
              {minPing !== null ? `${minPing}` : '—'}
              <span className="ml-1 text-xs font-normal text-zinc-400">ms</span>
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">本时段最优</p>
          </div>
          <div className="min-w-32 flex-1">
            <PingSparkline pings={pings} />
          </div>
        </div>
        {edgeNode && (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            你当前接入的 ESA 边缘节点:<span className="font-mono font-semibold text-zinc-600 dark:text-zinc-300">{edgeNode}</span>
            {EDGE_REGIONS[edgeNode] ? `(${EDGE_REGIONS[edgeNode]})` : ''}
          </p>
        )}
      </section>

      {/* 服务器性能 */}
      <section className="rounded-2xl border border-zinc-200/70 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">服务器性能</h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            每分钟采样{status?.host ? ` · 更新于 ${formatRelative(status.host.at)}` : ''}
          </span>
        </div>
        {status?.host ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Gauge label="CPU 占用" value={status.host.cpuPct} />
              <Gauge label="内存占用" value={status.host.memPct} />
              <Gauge label="磁盘占用" value={status.host.diskPct} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {(status.host.cpuCores || status.host.memTotalMb) && (
                <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">
                  规格 {status.host.cpuCores ? `${status.host.cpuCores} 核` : ''}{status.host.cpuCores && status.host.memTotalMb ? ' · ' : ''}{status.host.memTotalMb ? `${(status.host.memTotalMb / 1024).toFixed(1)} GB` : ''}
                </span>
              )}
              <span>
                实时带宽 ↓ <span className="font-mono font-semibold text-teal-600 dark:text-teal-300">{formatKbps(status.host.rxKbps)}</span>
                {'  '}↑ <span className="font-mono font-semibold text-indigo-500 dark:text-indigo-300">{formatKbps(status.host.txKbps)}</span>
              </span>
              <span>系统负载(1min)<span className="ml-1 font-mono font-semibold text-zinc-700 dark:text-zinc-200">{status.host.load1}</span></span>
            </div>
          </>
        ) : (
          <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">主机性能采样尚未就绪…</p>
        )}
      </section>

      {/* 服务状态卡片 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {(status?.services ?? []).map((s) => (
          <section key={s.key} className="rounded-2xl border border-zinc-200/70 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex items-center gap-2.5">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', statusDot(s.ok))} />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.label}</h3>
              <span
                className={cn(
                  'ml-auto rounded-md px-2 py-0.5 text-xs font-medium',
                  s.ok === true && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                  s.ok === false && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                  s.ok === null && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                )}
              >
                {statusText(s.ok)}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">当前延迟</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {s.latencyMs !== null ? `${s.latencyMs}ms` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">24h 可用率</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {s.uptime24h !== null ? `${s.uptime24h}%` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">24h 均延迟</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {s.avgLatency24h !== null ? `${s.avgLatency24h}ms` : '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <UptimeBars recent={s.recent} />
              <p className="mt-1.5 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                <span>← 约 1 小时前</span>
                <span>最近检查 {formatRelative(s.lastCheck)}</span>
              </p>
            </div>
          </section>
        ))}
      </div>

      <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
        数据来自站内探针(每分钟采样,保留 7 天)与你的浏览器实测,仅含非敏感运行指标。
      </p>
    </div>
  );
}
