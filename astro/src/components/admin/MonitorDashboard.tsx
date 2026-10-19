import React, { useCallback, useEffect, useState } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import { cn } from '../../lib/utils';

interface TargetSummary {
  key: string;
  target: string;
  label: string;
  latest: { ok: boolean; latencyMs: number; statusCode: number; error: string; at: string } | null;
  h24: { total: number; okCount: number; uptime: number | null; avgMs: number | null; p50Ms: number | null; p95Ms: number | null };
  d7: { total: number; okCount: number; uptime: number | null; avgMs: number | null; p50Ms: number | null; p95Ms: number | null };
}

interface SeriesBucket {
  target: string;
  bucket: string;
  avgMs: number;
  okRatio: number;
  count: number;
}

interface FailureItem {
  target: string;
  at: string;
  statusCode: number;
  latencyMs: number;
  error: string;
}

interface HostBucket {
  bucket: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  rxKbps: number;
  txKbps: number;
  load1: number;
  memUsedMb: number;
  memTotalMb: number;
  count: number;
}

interface HostData {
  latest: {
    cpuPct: number; memPct: number; memUsedMb: number; memTotalMb: number;
    rxKbps: number; txKbps: number; diskPct: number; load1: number; at: string;
  } | null;
  buckets: HostBucket[];
}

interface ProtectionSnapshot {
  ok: boolean;
  detected: number;
  blocked: number;
  sampledAt: string;
  error: string;
  at: string;
}

interface ProtectionData {
  latest10: ProtectionSnapshot[];
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

const TARGET_COLORS: Record<string, string> = {
  site_http: '#14b8a6',
  pb_self: '#6366f1',
  admin_auth: '#f59e0b',
};

const TARGET_LABELS: Record<string, string> = {
  site_http: '站点页面',
  pb_self: 'API 与数据库',
  admin_auth: '认证与邮件网关',
};

function fmtUptime(v: number | null) {
  return v === null ? '—' : `${v}%`;
}

function fmtMs(v: number | null) {
  return v === null ? '—' : `${v}ms`;
}

/** 通用双序列折线图 */
function DualLineChart({
  buckets, a, b, maxY, unit,
}: {
  buckets: HostBucket[];
  a: { key: keyof HostBucket & string; label: string; color: string };
  b: { key: keyof HostBucket & string; label: string; color: string };
  maxY?: number;
  unit: string;
}) {
  const w = 560;
  const h = 140;
  const pad = { l: 44, r: 8, t: 10, b: 18 };
  if (buckets.length < 2) {
    return <p className="py-10 text-center text-xs text-muted">采样数据积累中(每分钟一个点)…</p>;
  }
  const top = maxY ?? Math.max(...buckets.map((x) => Math.max(Number(x[a.key]) || 0, Number(x[b.key]) || 0)), 1);
  const minT = Date.parse(buckets[0].bucket);
  const maxT = Date.parse(buckets[buckets.length - 1].bucket);
  const spanT = Math.max(1, maxT - minT);
  const x = (t: number) => pad.l + ((t - minT) / spanT) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  const line = (key: string) =>
    buckets.map((bk) => `${x(Date.parse(bk.bucket)).toFixed(1)},${y(Number(bk[key as keyof HostBucket]) || 0).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="mb-1 flex gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-full" style={{ background: a.color }} />{a.label}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-full" style={{ background: b.color }} />{b.label}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`${a.label}与${b.label}趋势`}>
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line x1={pad.l} x2={w - pad.r} y1={y(r * top)} y2={y(r * top)} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
            <text x={pad.l - 5} y={y(r * top) + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.5">
              {Math.round(r * top)}{unit}
            </text>
          </g>
        ))}
        <polyline points={line(a.key)} fill="none" stroke={a.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line(b.key)} fill="none" stroke={b.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" strokeOpacity="0.75" />
        <text x={pad.l} y={h - 4} fontSize="9" fill="currentColor" opacity="0.5">{new Date(minT).toLocaleString()}</text>
        <text x={w - pad.r} y={h - 4} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.5">{new Date(maxT).toLocaleString()}</text>
      </svg>
    </div>
  );
}
function LatencyChart({ target, buckets }: { target: string; buckets: SeriesBucket[] }) {
  const data = buckets.filter((b) => b.target === target);
  const w = 560;
  const h = 140;
  const pad = { l: 40, r: 8, t: 10, b: 18 };
  if (data.length < 2) {
    return <p className="py-10 text-center text-xs text-muted">采样数据积累中(每分钟一个点)…</p>;
  }
  const maxMs = Math.max(...data.map((b) => b.avgMs), 20);
  const minT = Date.parse(data[0].bucket);
  const maxT = Date.parse(data[data.length - 1].bucket);
  const spanT = Math.max(1, maxT - minT);
  const x = (t: number) => pad.l + ((t - minT) / spanT) * (w - pad.l - pad.r);
  const y = (ms: number) => pad.t + (1 - ms / maxMs) * (h - pad.t - pad.b);
  const points = data.map((b) => `${x(Date.parse(b.bucket)).toFixed(1)},${y(b.avgMs).toFixed(1)}`).join(' ');
  const badPoints = data.filter((b) => b.okRatio < 1);
  const color = TARGET_COLORS[target] || '#14b8a6';
  const ticks = [0, 0.5, 1].map((r) => ({ y: y(r * maxMs), label: `${Math.round(r * maxMs)}` }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`${TARGET_LABELS[target] || target} 延迟趋势`}>
      {ticks.map((t) => (
        <g key={t.label}>
          <line x1={pad.l} x2={w - pad.r} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
          <text x={pad.l - 5} y={t.y + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.5">
            {t.label}
          </text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {badPoints.map((b) => (
        <circle key={b.bucket} cx={x(Date.parse(b.bucket))} cy={y(b.avgMs)} r="3" fill="#ef4444">
          <title>{`${new Date(b.bucket).toLocaleString()} · 可用率 ${Math.round(b.okRatio * 100)}%`}</title>
        </circle>
      ))}
      <text x={pad.l} y={h - 4} fontSize="9" fill="currentColor" opacity="0.5">
        {new Date(minT).toLocaleString()}
      </text>
      <text x={w - pad.r} y={h - 4} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.5">
        {new Date(maxT).toLocaleString()}
      </text>
    </svg>
  );
}

export default function MonitorDashboard() {
  const [summary, setSummary] = useState<{ targets: TargetSummary[] } | null>(null);
  const [series, setSeries] = useState<{ buckets: SeriesBucket[]; failures: FailureItem[] } | null>(null);
  const [host, setHost] = useState<HostData | null>(null);
  const [protection, setProtection] = useState<ProtectionData | null>(null);
  const [protectionError, setProtectionError] = useState(false);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (h: number) => {
    try {
      const pb = getPocketBase();
      const [sum, ser, hst] = await Promise.all([
        pb.send<{ targets: TargetSummary[] }>('/api/blog-admin/monitor/summary', { method: 'GET' }),
        pb.send<{ buckets: SeriesBucket[]; failures: FailureItem[] }>(`/api/blog-admin/monitor/series?hours=${h}`, { method: 'GET' }),
        pb.send<HostData>(`/api/blog-admin/monitor/host?hours=${h}`, { method: 'GET' }),
      ]);
      setSummary(sum);
      setSeries(ser);
      setHost(hst);
      setError('');
      // 防护采集为独立区块:其失败不得影响本页其他监控数据
      try {
        const prot = await pb.send<ProtectionData>('/api/blog-admin/monitor/protection', { method: 'GET' });
        setProtection(prot);
        setProtectionError(false);
      } catch {
        setProtectionError(true);
      }
    } catch (err) {
      setError('监控数据加载失败(权限或接口异常)');
      console.error('[monitor] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(hours);
    const timer = window.setInterval(() => void load(hours), 60_000);
    return () => window.clearInterval(timer);
  }, [hours, load]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">每分钟自动采样 · 保留 7 天 · 每 60 秒自动刷新</p>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5 text-xs shadow-xs">
          {[24, 48, 168].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(h)}
              className={cn(
                'min-h-8 rounded-md px-3 font-mono transition-colors',
                hours === h ? 'bg-accent/10 font-semibold text-accent' : 'text-text-secondary hover:text-text',
              )}
            >
              {h < 100 ? `${h}h` : '7d'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {/* 汇总卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        {(summary?.targets ?? []).map((t) => (
          <section key={t.target} className="rounded-xl border border-border bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', t.latest?.ok ? 'bg-success' : 'bg-danger')} />
              <h3 className="text-sm font-semibold text-text">{t.label}</h3>
              <span className="ml-auto font-mono text-[11px] text-muted">{t.target}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="font-mono text-lg font-bold tabular-nums text-text">{fmtUptime(t.h24.uptime)}</p>
                <p className="text-[11px] text-muted">24h 可用率</p>
              </div>
              <div>
                <p className="font-mono text-lg font-bold tabular-nums text-text">{fmtMs(t.h24.avgMs)}</p>
                <p className="text-[11px] text-muted">24h 均延迟</p>
              </div>
              <div>
                <p className="font-mono text-lg font-bold tabular-nums text-text">{fmtMs(t.h24.p95Ms)}</p>
                <p className="text-[11px] text-muted">24h P95</p>
              </div>
            </div>
            <div className="mt-3 flex justify-between border-t border-border/60 pt-2 font-mono text-[11px] text-muted">
              <span>7d 可用率 {fmtUptime(t.d7.uptime)}</span>
              <span>样本 {t.h24.total}</span>
            </div>
            {t.latest && !t.latest.ok && (
              <p className="mt-2 truncate rounded-md bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger" title={t.latest.error}>
                最近异常: {t.latest.error || `HTTP ${t.latest.statusCode}`}
              </p>
            )}
          </section>
        ))}
      </div>

      {/* 宿主机性能 */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">宿主机性能</h3>
          {host?.latest && (
            <p className="font-mono text-[11px] text-muted">
              内存 {host.latest.memUsedMb}/{host.latest.memTotalMb}MB · 磁盘 {host.latest.diskPct}% · load1 {host.latest.load1}
            </p>
          )}
        </div>
        {host?.latest ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DualLineChart
              buckets={host.buckets}
              a={{ key: 'cpuPct', label: 'CPU %', color: '#14b8a6' }}
              b={{ key: 'memPct', label: '内存 %', color: '#6366f1' }}
              maxY={100}
              unit="%"
            />
            <DualLineChart
              buckets={host.buckets}
              a={{ key: 'rxKbps', label: '下行 KB/s', color: '#14b8a6' }}
              b={{ key: 'txKbps', label: '上行 KB/s', color: '#f59e0b' }}
              unit=""
            />
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted">宿主机采样尚未上报(cron 每分钟一次)…</p>
        )}
      </section>

      {/* 延迟趋势 */}
      <div className="grid gap-4 lg:grid-cols-1">
        {Object.keys(TARGET_LABELS).map((target) => (
          <section key={target} className="rounded-xl border border-border bg-white p-4 shadow-xs">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">{TARGET_LABELS[target]} · 5 分钟均值延迟</h3>
              <span className="font-mono text-[11px] text-muted" style={{ color: TARGET_COLORS[target] }}>
                — {target}
              </span>
            </div>
            <LatencyChart target={target} buckets={series?.buckets ?? []} />
          </section>
        ))}
      </div>

      {/* 失败明细 */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-xs">
        <h3 className="mb-3 text-sm font-semibold text-text">最近失败样本</h3>
        {series?.failures?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">目标</th>
                  <th className="py-2 pr-3 font-medium">状态码</th>
                  <th className="py-2 pr-3 font-medium">延迟</th>
                  <th className="py-2 font-medium">错误</th>
                </tr>
              </thead>
              <tbody>
                {series.failures.map((f, i) => (
                  <tr key={`${f.at}-${i}`} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-text-secondary">{new Date(f.at.replace(' ', 'T')).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-mono text-text-secondary">{TARGET_LABELS[f.target] || f.target}</td>
                    <td className="py-2 pr-3 font-mono text-text-secondary">{f.statusCode || '—'}</td>
                    <td className="py-2 pr-3 font-mono text-text-secondary">{f.latencyMs}ms</td>
                    <td className="max-w-64 truncate py-2 font-mono text-danger" title={f.error}>{f.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted">{loading ? '加载中…' : '所选时段内没有失败样本,运行良好。'}</p>
        )}
      </section>

      {/* 防护采集(雷池 WAF 统计) */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">防护采集(雷池 WAF,近 24h)</h3>
          {protection && (
            <p className="font-mono text-[11px] text-muted">
              最近成功 {protection.lastSuccessAt ? new Date(protection.lastSuccessAt.replace(' ', 'T')).toLocaleString() : '从未'}
              {protection.consecutiveFailures > 0 && (
                <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-warning">连续失败 {protection.consecutiveFailures}</span>
              )}
            </p>
          )}
        </div>
        {protectionError && (
          <p className="py-4 text-center text-xs text-muted">防护采集接口不可用(不影响本页其他监控)。</p>
        )}
        {!protectionError && !protection && <p className="py-4 text-center text-xs text-muted">加载中…</p>}
        {!protectionError && protection && (
          <>
            {protection.latest10.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted">暂无采集快照(cron 每分钟写入)。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="py-2 pr-3 font-medium">采集时间</th>
                      <th className="py-2 pr-3 font-medium">窗口截止</th>
                      <th className="py-2 pr-3 font-medium">检测</th>
                      <th className="py-2 pr-3 font-medium">拦截</th>
                      <th className="py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {protection.latest10.map((s, i) => (
                      <tr key={`${s.at}-${i}`} className="border-b border-border/50 last:border-0">
                        <td className="whitespace-nowrap py-2 pr-3 font-mono text-text-secondary">{new Date(s.at.replace(' ', 'T')).toLocaleString()}</td>
                        <td className="whitespace-nowrap py-2 pr-3 font-mono text-text-secondary">{s.sampledAt ? new Date(s.sampledAt).toLocaleString() : '—'}</td>
                        <td className="py-2 pr-3 font-mono text-text-secondary">{s.ok ? s.detected : '—'}</td>
                        <td className="py-2 pr-3 font-mono text-text-secondary">{s.ok ? s.blocked : '—'}</td>
                        <td className={cn('max-w-56 truncate py-2 font-mono', s.ok ? 'text-success' : 'text-danger')} title={s.error}>
                          {s.ok ? '正常' : `失败: ${s.error || 'unknown'}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
