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

/** 两位序号：服务分组的等宽索引。 */
function formatOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/** 状态标记：正常 = 强调色，异常 = 语义危险色，未知 = 次级文字色。 */
function statusDot(ok: boolean | null) {
  if (ok === true) return 'bg-[var(--sf-accent)]';
  if (ok === false) return 'bg-[var(--sf-danger)]';
  return 'bg-[var(--sf-ink-3)]';
}

/** 状态徽标：与标记点同语义，细线框 + 等宽小字。 */
function statusBadge(ok: boolean | null) {
  if (ok === true) return 'border-[var(--sf-accent)] text-[var(--sf-accent-ink)]';
  if (ok === false) return 'border-[var(--sf-danger)] text-[var(--sf-danger)]';
  return 'border-[var(--sf-line)] text-[var(--sf-ink-3)]';
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

/** 最近采样点的可用率细线柱：正常=强调色，异常=危险色；高度仍按延迟映射。 */
function UptimeBars({ recent }: { recent: SamplePoint[] }) {
  if (!recent.length) {
    return <p className="font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">采样数据积累中…</p>;
  }
  return (
    <div
      className="flex h-8 items-end gap-[2px] border-b border-[var(--sf-line-soft)]"
      role="img"
      aria-label="最近采样可用率"
    >
      {recent.map((s, i) => (
        <span
          key={`${s.t}-${i}`}
          title={`${new Date(s.t.replace(' ', 'T')).toLocaleTimeString()} · ${s.ok ? '正常' : '异常'} · ${s.ms}ms`}
          className={cn(
            'w-full min-w-[2px] flex-1 transition-opacity duration-150 hover:opacity-75',
            s.ok ? 'bg-[var(--sf-accent)]' : 'bg-[var(--sf-danger)]',
          )}
          style={{ height: `${Math.max(25, Math.min(100, (s.ms / 400) * 100))}%` }}
        />
      ))}
    </div>
  );
}

/** 用户端实测延迟迷你走势：单根 1.25px 描边折线，无填充无发光。 */
function PingSparkline({ pings }: { pings: number[] }) {
  if (pings.length < 2) return null;
  const max = Math.max(...pings, 50);
  const w = 120;
  const h = 32;
  const points = pings
    .map((v, i) => `${(i / (pings.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-full text-[var(--sf-accent)]"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 资源占用仪表：2px 细线轨道 + 纯色填充，阈值判定沿用原有分档。 */
function Gauge({ label, value, unit = '%' }: { label: string; value: number | null; unit?: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  const tone =
    value === null
      ? 'bg-[var(--sf-line-control)]'
      : pct >= 85
        ? 'bg-[var(--sf-danger)]'
        : pct >= 70
          ? 'bg-amber-500'
          : 'bg-[var(--sf-accent)]';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-[var(--sf-ink)]">
          {value === null ? '—' : `${value}${unit}`}
        </span>
      </div>
      <div
        className="mt-2 h-[2px] overflow-hidden bg-[var(--sf-line)]"
        aria-hidden="true"
      >
        <div
          className={cn('h-full transition-[width] duration-700 motion-reduce:transition-none', tone)}
          style={{ width: `${pct}%` }}
        />
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

  // 失败时若已有一份成功数据，继续按真实 overall 展示，并在下方单独提示刷新失败；
  // 只有从未拿到状态时才落到 unknown。
  const overall = status?.overall ?? 'unknown';
  const overallTone =
    overall === 'operational'
      ? 'bg-[var(--sf-accent)]'
      : overall === 'outage'
        ? 'bg-[var(--sf-danger)]'
        : 'bg-[var(--sf-ink-3)]';
  const currentPing = pings.length ? pings[pings.length - 1] : null;
  const minPing = pings.length ? Math.min(...pings) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 总览横幅 */}
      <div
        role="status"
        className="flex items-stretch overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]"
      >
        <span aria-hidden="true" className={cn('w-[3px] shrink-0', overallTone)} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pr-4 pl-3.5">
          <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.2em] text-[var(--sf-ink-3)]">
            SYS
          </span>
          <p className="text-sm font-medium text-[var(--sf-ink)]">
            {overall === 'operational' && '所有系统运行正常'}
            {overall === 'outage' && '部分服务异常,正在处理'}
            {overall === 'unknown' && (statusError ? '状态接口暂时不可用' : '状态加载中…')}
          </p>
          {status?.now && (
            <span className="ml-auto font-mono text-[10px] tabular-nums tracking-[0.06em] text-[var(--sf-ink-3)]">
              更新于 {formatRelative(status.now)} · 每 30 秒自动刷新
            </span>
          )}
        </div>
      </div>

      {statusError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-[var(--sf-danger)] bg-[var(--sf-surface)] px-4 py-3"
        >
          <p className="text-xs leading-5 text-[var(--sf-ink-2)]">
            {status ? '状态刷新失败，正在展示上一次成功数据。' : '状态接口请求失败，请稍后重试。'}
          </p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-[3px] border border-[var(--sf-line-control)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--sf-ink-2)] transition-colors hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent-ink)]"
          >
            重试状态
          </button>
        </div>
      )}

      {/* 用户到服务器延迟(本机实测) */}
      <section className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">
            PING / 01
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">你到本站的延迟</h2>
          <span className="ml-auto font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">
            浏览器实测 · 每 15 秒探测 {PING_COUNT} 次取均值
          </span>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="flex items-baseline gap-1 font-mono text-[28px] leading-none font-semibold tabular-nums text-[var(--sf-accent-ink)]">
              <span>{currentPing !== null ? `${currentPing}` : '—'}</span>
              <span className="text-sm font-normal text-[var(--sf-ink-3)]">ms</span>
            </p>
            <p className="mt-2 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">动态接口(回源)</p>
          </div>
          <div>
            <p className="flex items-baseline gap-1 font-mono text-xl leading-none font-semibold tabular-nums text-[var(--sf-ink)]">
              <span>{staticMs !== null ? `${staticMs}` : '—'}</span>
              <span className="text-[11px] font-normal text-[var(--sf-ink-3)]">ms</span>
            </p>
            <p className="mt-2 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">
              静态资源(CDN 边缘)
            </p>
          </div>
          <div>
            <p className="flex items-baseline gap-1 font-mono text-xl leading-none font-semibold tabular-nums text-[var(--sf-ink)]">
              <span>{minPing !== null ? `${minPing}` : '—'}</span>
              <span className="text-[11px] font-normal text-[var(--sf-ink-3)]">ms</span>
            </p>
            <p className="mt-2 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">本时段最优</p>
          </div>
          <div className="min-w-32 flex-1 border-b border-[var(--sf-line-soft)] pb-1">
            <PingSparkline pings={pings} />
          </div>
        </div>
        {edgeNode && (
          <p className="mt-4 border-t border-[var(--sf-line-soft)] pt-3 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">
            你当前接入的 ESA 边缘节点:<span className="ml-1 font-semibold text-[var(--sf-ink)]">{edgeNode}</span>
            {EDGE_REGIONS[edgeNode] ? `(${EDGE_REGIONS[edgeNode]})` : ''}
          </p>
        )}
      </section>

      {/* 服务器性能 */}
      <section className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">
            HOST / 02
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">服务器性能</h2>
          <span className="ml-auto font-mono text-[10px] tracking-[0.06em] text-[var(--sf-ink-3)]">
            每分钟采样{status?.host ? ` · 更新于 ${formatRelative(status.host.at)}` : ''}
          </span>
        </div>
        {status?.host ? (
          <>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <Gauge label="CPU 占用" value={status.host.cpuPct} />
              <Gauge label="内存占用" value={status.host.memPct} />
              <Gauge label="磁盘占用" value={status.host.diskPct} />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--sf-line-soft)] pt-3 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">
              {(status.host.cpuCores || status.host.memTotalMb) && (
                <span className="font-semibold tabular-nums text-[var(--sf-ink-2)]">
                  规格 {status.host.cpuCores ? `${status.host.cpuCores} 核` : ''}{status.host.cpuCores && status.host.memTotalMb ? ' · ' : ''}{status.host.memTotalMb ? `${(status.host.memTotalMb / 1024).toFixed(1)} GB` : ''}
                </span>
              )}
              <span className="flex flex-wrap items-center gap-1">
                实时带宽 <span aria-hidden="true">↓</span>
                <span className="font-semibold tabular-nums text-[var(--sf-accent-ink)]">
                  {formatKbps(status.host.rxKbps)}
                </span>
                <span aria-hidden="true" className="ml-1">↑</span>
                <span className="font-semibold tabular-nums text-[var(--sf-ink)]">
                  {formatKbps(status.host.txKbps)}
                </span>
              </span>
              <span>
                系统负载(1min)
                <span className="ml-1 font-semibold tabular-nums text-[var(--sf-ink)]">{status.host.load1}</span>
              </span>
            </div>
          </>
        ) : (
          <p className="mt-4 font-mono text-[11px] tracking-[0.04em] text-[var(--sf-ink-3)]">
            主机性能采样尚未就绪…
          </p>
        )}
      </section>

      {/* 服务状态分组：数据 / 空 / 失败 / 加载四态可区分 */}
      {(status?.services ?? []).length === 0 ? (
        <p
          data-state={statusError ? 'error' : status ? 'empty' : 'loading'}
          className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-4 py-5 text-center font-mono text-[11px] leading-6 tracking-[0.04em] text-[var(--sf-ink-3)]"
        >
          {statusError ? '服务列表加载失败，请稍后重试。' : status ? '服务列表尚未配置。' : '服务列表加载中…'}
        </p>
      ) : (
      <div data-state="ready" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(status?.services ?? []).map((s, index) => (
          <section
            key={s.key}
            className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4"
          >
            <div className="flex items-baseline justify-between gap-2 border-b border-[var(--sf-line-soft)] pb-2">
              <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.16em] text-[var(--sf-ink-3)]">
                SVC / {formatOrdinal(index)}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em]',
                  statusBadge(s.ok),
                )}
              >
                {statusText(s.ok)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', statusDot(s.ok))} />
              <h3 className="text-sm font-semibold tracking-tight text-[var(--sf-ink)]">{s.label}</h3>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--sf-line-soft)] pt-3 text-center">
              <div>
                <dt className="font-mono text-[11px] tracking-[0.02em] text-[var(--sf-ink-3)]">当前延迟</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--sf-ink)]">
                  {s.latencyMs !== null ? `${s.latencyMs}ms` : '—'}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] tracking-[0.02em] text-[var(--sf-ink-3)]">24h 可用率</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--sf-ink)]">
                  {s.uptime24h !== null ? `${s.uptime24h}%` : '—'}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] tracking-[0.02em] text-[var(--sf-ink-3)]">24h 均延迟</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--sf-ink)]">
                  {s.avgLatency24h !== null ? `${s.avgLatency24h}ms` : '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <UptimeBars recent={s.recent} />
              <p className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.04em] text-[var(--sf-ink-3)]">
                <span>← 约 1 小时前</span>
                <span>最近检查 {formatRelative(s.lastCheck)}</span>
              </p>
            </div>
          </section>
        ))}
      </div>
      )}

      <p className="text-center text-[11px] leading-6 text-[var(--sf-ink-3)]">
        数据来自站内探针(每分钟采样,保留 7 天)与你的浏览器实测,仅含非敏感运行指标。
      </p>
    </div>
  );
}
