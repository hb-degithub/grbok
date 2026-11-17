import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * 首页 Hero 右侧：本站**真实请求链路**（Browser → ESA → 雷池 SafeLine → Caddy → Astro SSR / PocketBase）。
 *
 * 链路结构来自 CLAUDE.md 的线上拓扑；指标全部复用 StatusMini 已在用的三个公开接口，
 * 不新增任何接口、不改后端：
 *   GET /api/public/status      → overall、services[].ok / avgLatency24h / uptime24h
 *   GET /api/public/protection  → safeline.state、safeline.blocked（24h 拦截数）
 *   GET /api/public/ping        → 客户端实测往返，取 3 次均值（与 StatusMini 完全一致）
 *
 * 硬约束：Caddy 这一跳**没有独立的逐跳探测**，因此固定显示「未采集」，
 * 生产代码里不写死任何毫秒字面量——所有数字只能来自上面三个接口或浏览器实测。
 */

type SourcePhase = 'loading' | 'ready' | 'failed';
type OverallKey = 'operational' | 'outage' | 'unknown';

interface PublicService {
  key: string;
  ok: boolean | null;
  avgLatency24h: number | null;
  uptime24h: number | null;
}

interface PublicStatusPayload {
  overall?: string;
  services?: PublicService[];
}

interface PublicProtectionPayload {
  safeline?: { state?: string | null; blocked?: number | null };
}

/** overall 文案：未知/缺失/请求失败一律回退「检测中」，与 StatusMini 同源同文案。 */
const OVERALL_TEXT: Record<OverallKey, string> = {
  operational: '运行正常',
  outage: '部分异常',
  unknown: '检测中',
};

/** 雷池公开状态来自 protection_lib.js：ok / stale / unavailable。 */
const SAFELINE_TEXT: Record<string, string> = {
  ok: '采集中',
  stale: '数据过期',
  unavailable: '未接入',
};

/** 未采集/取不到时的统一占位符（真实文本，不靠颜色表达状态）。 */
const UNKNOWN = '—';

const POLL_INTERVAL_MS = 30_000;

/** 加载中的细线占位：固定宽度、无圆角跳变，不改变行高。 */
function SkeletonBar({ width }: { width: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[2px] rounded-[1px] bg-[var(--sf-line-strong)] align-middle"
      style={{ width }}
    />
  );
}

interface HopNote {
  label: string;
  /** string = 真实数值；null = 还在加载（骨架）；undefined = 该行只有静态说明。 */
  value?: string | null;
}

interface HopView {
  key: string;
  index: string;
  name: string;
  detail: string;
  /** 指标前缀（例如「客户端 RTT」），让数值读起来仍然是完整的一句话。 */
  prefix?: string;
  value: string | null;
  notes: HopNote[];
  /** Caddy 之后分叉出来的终点：缩进 + 更长的短横线。 */
  branch: boolean;
  /** 链路末端：竖线在节点中线收口。 */
  tail: boolean;
}

export default function RequestPath() {
  const [status, setStatus] = useState<PublicStatusPayload | null>(null);
  const [statusPhase, setStatusPhase] = useState<SourcePhase>('loading');
  const [protection, setProtection] = useState<{ state: string | null; blocked: number | null } | null>(null);
  const [protectionPhase, setProtectionPhase] = useState<SourcePhase>('loading');
  const [ping, setPing] = useState<number | null>(null);
  const [pingPhase, setPingPhase] = useState<SourcePhase>('loading');

  /** 状态 + 防护统计：与 StatusMini 相同的路径与解析，30s 轮询。 */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('status failed');
      setStatus((await res.json()) as PublicStatusPayload);
      setStatusPhase('ready');
    } catch {
      setStatus(null);
      setStatusPhase('failed');
    }

    try {
      const res = await fetch('/api/public/protection', { cache: 'no-store' });
      if (!res.ok) throw new Error('protection failed');
      const payload = (await res.json()) as PublicProtectionPayload;
      const state = typeof payload?.safeline?.state === 'string' ? payload.safeline.state : null;
      // 沿用 StatusMini 的判定：只有 state === 'ok' 且 blocked 是数字才算真实拦截数，
      // stale / unavailable 时数字不可信，一律不展示（避免把过期值当实时值）。
      const blocked =
        state === 'ok' && typeof payload?.safeline?.blocked === 'number' ? payload.safeline.blocked : null;
      setProtection({ state, blocked });
      setProtectionPhase('ready');
    } catch {
      setProtection(null);
      setProtectionPhase('failed');
    }
  }, []);

  /** 浏览器实测往返：连打 3 次取均值，单次失败跳过（与 StatusMini 一致）。 */
  const pingServer = useCallback(async () => {
    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      try {
        const res = await fetch(`/api/public/ping?t=${Date.now()}`, { cache: 'no-store' });
        // 只有真正拿到 2xx 才算一次有效往返：错误页/网关 502 的往返时间不是链路时延，
        // 记下来会把「接口挂了」渲染成一个看着正常的毫秒数。
        if (!res.ok) throw new Error('ping failed');
        samples.push(performance.now() - start);
      } catch {
        // 单次失败不影响其余采样
      }
    }
    if (samples.length) {
      setPing(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length));
      setPingPhase('ready');
    } else {
      setPing(null);
      setPingPhase('failed');
    }
  }, []);

  useEffect(() => {
    void load();
    void pingServer();
    const a = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    const b = window.setInterval(() => void pingServer(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, [load, pingServer]);

  const overallKey: OverallKey =
    status?.overall === 'operational' || status?.overall === 'outage' ? status.overall : 'unknown';

  const services = status?.services ?? [];
  const siteService = services.find((s) => s.key === 'site') ?? undefined;
  // 线上的 /api/public/status 实际以 'api' 作为 PocketBase 采集目标的 key
  // （见 pb_hooks/lib/monitor_lib.js 的 PUBLIC_TARGETS），这里同时接受 'pb' 命名，
  // 面板语义仍按「PocketBase 一跳」展示，不因为 key 命名差异编造一个数。
  const pbService = services.find((s) => s.key === 'pb') ?? services.find((s) => s.key === 'api') ?? undefined;
  // 线上 /api/public/status 的 'gateway' 采集目标就是 Caddy 这一跳（反代/分流层），
  // 有真实采集值就用真实值；该目标不存在时才退回「未采集」，绝不填估算毫秒。
  const gatewayService = services.find((s) => s.key === 'gateway') ?? undefined;

  const statusLoading = statusPhase === 'loading';
  const protectionLoading = protectionPhase === 'loading';
  const pingLoading = pingPhase === 'loading';
  const loading = statusLoading || protectionLoading || pingLoading;

  const latencyText = (value: number | null | undefined): string | null =>
    value != null ? `${value} ms` : null;

  const hops: HopView[] = [
    {
      key: 'edge',
      index: '01',
      name: 'ESA 边缘',
      detail: '公网入口 · CDN/WAF',
      prefix: '客户端 RTT',
      // 端到端真实测量（浏览器 → 边缘 → 源站回环），不是某一跳的估算值。
      value: pingLoading ? null : ping != null ? `${ping} ms` : UNKNOWN,
      notes: [{ label: '端到端实测' }],
      branch: false,
      tail: false,
    },
    {
      key: 'safeline',
      index: '02',
      name: '雷池 SafeLine',
      detail: 'WAF',
      value: protectionLoading
        ? null
        : protection?.state
          ? (SAFELINE_TEXT[protection.state] ?? protection.state)
          : UNKNOWN,
      notes: [
        {
          label: '24h 拦截',
          value: protectionLoading ? null : protection?.blocked != null ? String(protection.blocked) : UNKNOWN,
        },
      ],
      branch: false,
      tail: false,
    },
    {
      key: 'caddy',
      index: '03',
      name: 'Caddy',
      detail: '反代 · 分流',
      // gateway 采集目标存在时展示真实 24h 均值；不存在才写「未采集」。
      value: statusLoading
        ? null
        : latencyText(gatewayService?.avgLatency24h) ?? '未采集',
      notes: gatewayService
        ? [{ label: '24h 平均响应' }]
        : [{ label: '无逐跳探测', value: UNKNOWN }],
      branch: false,
      tail: false,
    },
    {
      key: 'astro',
      index: '04',
      name: 'Astro SSR',
      detail: '页面 · SSR',
      value: statusLoading ? null : latencyText(siteService?.avgLatency24h) ?? UNKNOWN,
      notes: [
        { label: '24h 平均响应' },
        {
          label: '可用率',
          value: statusLoading
            ? null
            : siteService?.uptime24h != null
              ? `${siteService.uptime24h}%`
              : UNKNOWN,
        },
      ],
      branch: true,
      tail: false,
    },
    {
      key: 'pocketbase',
      index: '05',
      name: 'PocketBase',
      detail: '接口 · /api/*',
      value: statusLoading
        ? null
        : pbService?.ok === true
          ? '正常'
          : pbService?.ok === false
            ? '异常'
            : UNKNOWN,
      notes: [
        {
          label: '24h 平均',
          value: statusLoading ? null : latencyText(pbService?.avgLatency24h) ?? UNKNOWN,
        },
      ],
      branch: true,
      tail: true,
    },
  ];

  const overallDot =
    overallKey === 'operational'
      ? 'bg-[var(--sf-accent)]'
      : overallKey === 'outage'
        ? 'bg-[var(--sf-danger)]'
        : 'bg-[var(--sf-ink-3)]';

  return (
    <div className="relative w-full border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:p-6">
      <span aria-hidden="true" className="pointer-events-none absolute -left-px -top-px h-3 w-3 border-l border-t border-[var(--sf-line-strong)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-px -top-px h-3 w-3 border-r border-t border-[var(--sf-line-strong)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b border-l border-[var(--sf-line-strong)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b border-r border-[var(--sf-line-strong)]" />

      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-[var(--sf-line-soft)] pb-2">
        <span className="font-mono text-[0.625rem] uppercase leading-none tracking-[0.2em] text-[var(--sf-ink-3)]">
          REQUEST PATH / 01
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-[var(--sf-line-soft)] px-1.5 py-1">
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', overallDot)} />
          <span className="font-mono text-[0.625rem] leading-none tracking-[0.06em] text-[var(--sf-ink)]">
            {OVERALL_TEXT[overallKey]}
          </span>
        </span>
      </div>

      <ol role="list" aria-label="真实请求链路" aria-busy={loading} className="m-0 list-none p-0">
        {hops.map((hop, i) => (
          <li
            key={hop.key}
            className={cn('relative', hop.branch ? 'pl-10' : 'pl-6', hop.tail ? 'pb-0' : 'pb-1.5')}
          >
            {/* 链路装饰层：竖线走主干，短横线接到节点；分叉段用强调色区分。全部 aria-hidden。 */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute left-2.5 w-px bg-[var(--sf-line-strong)]',
                i === 0 ? 'bottom-0 top-1/2' : hop.tail ? 'top-0 bottom-1/2' : 'inset-y-0',
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute left-2.5 top-1/2 h-px -translate-y-1/2',
                hop.branch ? 'w-[1.875rem] bg-[var(--sf-accent)]' : 'w-3.5 bg-[var(--sf-line-strong)]',
              )}
            />

            <div className="grid min-h-[46px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[3px] border border-[var(--sf-line)] px-2.5 py-2">
              <div className="min-w-0">
                <p className="flex min-w-0 items-baseline gap-1.5">
                  <span className="font-mono text-[0.625rem] leading-none tabular-nums text-[var(--sf-ink-3)]">
                    {hop.index}
                  </span>
                  <span className="truncate text-[0.8125rem] font-medium leading-tight text-[var(--sf-ink)]">
                    {hop.name}
                  </span>
                </p>
                <p className="mt-1 truncate font-mono text-[0.625rem] leading-none tracking-[0.04em] text-[var(--sf-ink-3)]">
                  {hop.detail}
                </p>
              </div>

              <div className="min-w-0 text-right">
                <p className="flex min-h-[1rem] items-center justify-end gap-1 font-mono text-[0.75rem] font-medium leading-none tabular-nums text-[var(--sf-ink)]">
                  {hop.prefix && (
                    <span className="whitespace-nowrap font-normal text-[var(--sf-ink-3)]">{hop.prefix}</span>
                  )}
                  {hop.value === null ? (
                    <>
                      <SkeletonBar width="3.5rem" />
                      <span className="sr-only">指标读取中</span>
                    </>
                  ) : (
                    <span className="whitespace-nowrap">{hop.value}</span>
                  )}
                </p>
                {hop.notes.map((note) => (
                  <p
                    key={note.label}
                    className="mt-1 flex items-baseline justify-end gap-1 font-mono text-[0.625rem] leading-none tracking-[0.02em] text-[var(--sf-ink-3)]"
                  >
                    <span className="whitespace-nowrap">{note.label}</span>
                    {note.value === undefined ? null : note.value === null ? (
                      <SkeletonBar width="2.5rem" />
                    ) : (
                      <span className="whitespace-nowrap font-medium tabular-nums text-[var(--sf-ink-2)]">
                        {note.value}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
