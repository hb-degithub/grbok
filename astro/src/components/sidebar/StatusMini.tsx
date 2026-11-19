import { usePublicStatus } from '../../hooks/usePublicStatus';
import { cn } from '../../lib/utils';

/**
 * 首页迷你运行状态卡：站点状态 + 24h 延迟均值 + 访客实测延迟。
 *
 * 数据全部来自共享 `usePublicStatus()`（与 Hero 的 RequestPath 共用同一份快照与
 * 30s 轮询），组件自身不再 fetch、不再持有 timer：
 *
 *   GET /api/public/status      → overall、services[].avgLatency24h / uptime24h
 *   GET /api/public/protection  → safeline.state / safeline.blocked（仅 ok 可信）
 *   GET /api/public/ping        → 浏览器实测往返（3 次均值）
 *
 * 硬约束：
 * - `/api/public/status` 生产上可能只返回 `{ overall: 'unknown' }` 或完全没有
 *   services，因此 services 一律可选访问；
 * - 未知 overall / 接口失败 / 未落地一律回退「检测中」，不把失败显示成「运行正常」；
 * - 24h 攻击拦截只在 `safeline.state === 'ok'` 时展示真实数字，其余不显示；
 * - 保留指向 `/status` 的完整状态页链接与三块指标文案。
 */

interface OverallText {
  operational: string;
  outage: string;
  unknown: string;
}

const OVERALL_TEXT: OverallText = {
  operational: '运行正常',
  outage: '部分异常',
  unknown: '检测中',
};

/** 未采集/加载中/失败时的统一占位符（真实文本，不靠颜色表达状态）。 */
const UNKNOWN = '—';

export default function StatusMini() {
  const { status, pingMs, blocked24h } = usePublicStatus();

  // overall 只接受两个已知值，其余（缺失、未知字符串、请求失败）回退 unknown。
  const overallKey =
    status?.overall === 'operational' || status?.overall === 'outage' ? status.overall : 'unknown';
  const overallText = OVERALL_TEXT[overallKey];

  // 生产接口以 'site' 作为 Astro SSR 采集目标；services 缺失时就是 undefined。
  const site = status?.services?.find((service) => service.key === 'site');

  const latencyText = site?.avgLatency24h != null ? `${site.avgLatency24h}` : UNKNOWN;
  const uptimeText = site?.uptime24h != null ? `${site.uptime24h}` : UNKNOWN;
  const pingText = pingMs != null ? `${pingMs}` : UNKNOWN;

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
            {latencyText}
            <span className="text-[10px] font-normal text-[var(--sf-ink-3)]">ms</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--sf-ink-3)]">24h 延迟</p>
        </div>
        <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-1 py-2">
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--sf-ink)]">
            {uptimeText}
            <span className="text-[10px] font-normal text-[var(--sf-ink-3)]">%</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--sf-ink-3)]">24h 可用率</p>
        </div>
        <div className="rounded-[2px] border border-[var(--sf-line-soft)] px-1 py-2">
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--sf-accent)]">
            {pingText}
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
