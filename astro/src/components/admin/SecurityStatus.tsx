import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';

interface Policy {
  key: string;
  limit: number;
  windowSeconds: number;
}

interface Bucket {
  key: string;
  count?: number;
  lastTriggered?: string;
  locked?: boolean;
  lockUntil?: string;
}

interface Stats {
  comments?: number;
  pendingComments?: number;
  reports?: number;
  pendingReports?: number;
}

interface SecurityEvent {
  id: string;
  action: string;
  actor: string;
  target: string;
  detail: string;
  created: string;
}

interface SecurityStatusData {
  policies: Policy[];
  buckets: Bucket[];
  stats: Stats;
  timestamp: string;
}

/**
 * 安全防护状态（只读展示）。
 *
 * 行为保持不变：仍是同一组 GET 请求、同一组错误文案与同一套 bucket 分组过滤；
 * 视觉改为「表面色 + 冷灰细线」的后台语言——数字用等宽 + tabular-nums，
 * 状态色只做语义（警告 amber、锁定 --sf-danger），不再使用彩色底块。
 */
const PANEL =
  'min-w-0 overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]';
const SECTION_HEAD =
  'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sf-line)] px-3 py-2';
const SECTION_TITLE = 'text-[13px] font-semibold tracking-tight text-[var(--sf-ink)]';
const ROW = 'border-b border-[var(--sf-line-soft)] last:border-b-0';
const TH =
  'whitespace-nowrap px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--sf-ink-3)]';
const TD = 'whitespace-nowrap px-2 py-2 align-middle';

function Section({
  title,
  hint,
  hintClassName,
  children,
  bodyClassName,
}: {
  title: string;
  hint?: string;
  hintClassName?: string;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h3 className={SECTION_TITLE}>{title}</h3>
        <span className="ml-1 h-px min-w-4 flex-1 bg-[var(--sf-line)]" aria-hidden="true" />
        {hint && (
          <span className={`font-mono text-[10px] tracking-[0.12em] ${hintClassName ?? 'text-[var(--sf-ink-3)]'}`}>
            {hint}
          </span>
        )}
      </div>
      <div className={bodyClassName ?? 'px-3 py-2.5'}>{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number | string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--sf-ink-3)]">{label}</p>
      <p
        className={`mt-1.5 font-mono text-2xl font-bold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere] ${valueClassName ?? 'text-[var(--sf-ink)]'}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function SecurityStatus() {
  const [data, setData] = useState<SecurityStatusData | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pb = getPocketBase();
        const [statusRes, eventsRes] = await Promise.all([
          pb.send<SecurityStatusData>('/api/blog-admin/security/status', { method: 'GET' }),
          pb.send<{ events: SecurityEvent[] }>('/api/blog-admin/security/events', { method: 'GET' }),
        ]);
        setData(statusRes);
        setEvents(eventsRes.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className={PANEL}>
        <div className="animate-pulse space-y-3 p-4">
          <div className="h-3 w-1/3 rounded-[2px] bg-[var(--sf-line-soft)]" />
          <div className="h-3 w-1/2 rounded-[2px] bg-[var(--sf-line-soft)]" />
          <div className="h-3 w-2/3 rounded-[2px] bg-[var(--sf-line-soft)]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={PANEL}>
        <p role="alert" className="break-words p-4 text-sm text-[var(--sf-danger)] [overflow-wrap:anywhere]">
          加载防护状态失败：{error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const activeBuckets = data.buckets.filter(b => !b.locked);
  const lockedBuckets = data.buckets.filter(b => b.locked);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* 统计指标：数字等宽对齐，语义色只给待处理项 */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="总评论数" value={data.stats.comments ?? 0} />
        <Metric
          label="待审核评论"
          value={data.stats.pendingComments ?? 0}
          valueClassName="text-amber-700 dark:text-amber-300"
        />
        <Metric label="总举报数" value={data.stats.reports ?? 0} />
        <Metric
          label="待处理举报"
          value={data.stats.pendingReports ?? 0}
          valueClassName="text-[var(--sf-danger)]"
        />
      </div>

      {/* 限流策略 */}
      <Section title="限流策略" hint={`${data.policies.length} 条`} bodyClassName="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--sf-line)]">
                <th scope="col" className={TH}>策略</th>
                <th scope="col" className={TH}>限制</th>
                <th scope="col" className={TH}>窗口</th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map((p) => (
                <tr key={p.key} className={`transition-colors hover:bg-[var(--sf-canvas)] ${ROW}`}>
                  <td className={`${TD} font-mono text-xs text-[var(--sf-ink-2)]`}>{p.key}</td>
                  <td className={`${TD} font-mono text-sm tabular-nums text-[var(--sf-ink)]`}>{p.limit} 次</td>
                  <td className={`${TD} font-mono text-xs tabular-nums text-[var(--sf-ink-3)]`}>{p.windowSeconds} 秒</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 活跃限流桶 */}
      {activeBuckets.length > 0 && (
        <Section title="活跃限流" hint={`${activeBuckets.length} 个`} bodyClassName="px-0 py-0">
          <div>
            {activeBuckets.map((b) => (
              <div key={b.key} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 ${ROW}`}>
                <span className="min-w-0 break-all font-mono text-xs text-[var(--sf-ink-2)]">{b.key}</span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--sf-ink-3)]">
                  {b.count} 次 · {b.lastTriggered ? new Date(b.lastTriggered).toLocaleString('zh-CN') : '-'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 锁定状态：危险语义色只出现在文本与左侧细标上 */}
      {lockedBuckets.length > 0 && (
        <Section
          title="当前锁定"
          hint={`${lockedBuckets.length} 个`}
          hintClassName="text-[var(--sf-danger)]"
          bodyClassName="px-0 py-0"
        >
          <div>
            {lockedBuckets.map((b) => (
              <div key={b.key} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 ${ROW}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-[2px] shrink-0 bg-[var(--sf-danger)]" aria-hidden="true" />
                  <span className="min-w-0 break-all font-mono text-xs text-[var(--sf-danger)]">{b.key}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--sf-danger)]">
                  锁定至 {b.lockUntil ? new Date(b.lockUntil).toLocaleString('zh-CN') : '-'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 最近安全事件 */}
      {events.length > 0 && (
        <Section title="最近安全事件" hint={`${events.length} 条`} bodyClassName="px-0 py-0">
          <div>
            {events.map((e) => (
              <div key={e.id} className={`px-3 py-2.5 ${ROW}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="break-words text-xs font-medium text-[var(--sf-ink)] [overflow-wrap:anywhere]">{e.action}</span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--sf-ink-3)]">{new Date(e.created).toLocaleString('zh-CN')}</span>
                </div>
                <p className="mt-1 break-words font-mono text-[11px] text-[var(--sf-ink-3)] [overflow-wrap:anywhere]">
                  {e.actor} → {e.target}
                </p>
                {e.detail && <p className="mt-1 break-words text-xs text-[var(--sf-ink-2)] [overflow-wrap:anywhere]">{e.detail}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--sf-ink-3)]">
        最后更新：{new Date(data.timestamp).toLocaleString('zh-CN')}
      </p>
    </motion.div>
  );
}
