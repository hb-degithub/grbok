import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import CountUp from '../reactbits/CountUp';
import { fadeUp, staggerContainer } from '../../lib/motion';
import { useStats } from '../../hooks/domains/useStats';
import DualModeGeoMap from './DualModeGeoMap';
import { ALPHA2_TO_NUMERIC, ALPHA2_TO_ZH_NAME } from '../../lib/geoConstants';
import type { StatsData } from '../../lib/services/statsService';

interface StatsDashboardProps {
  variant?: 'public' | 'admin';
}

const CATEGORY_LABELS: Record<string, string> = {
  desktop: '桌面',
  mobile: '手机',
  tablet: '平板',
  bot: '爬虫',
};

/** 校验链接安全性，防止 javascript: 等协议注入 */
function safeHref(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? path : '#';
}

export default function StatsDashboard({ variant = 'public' }: StatsDashboardProps) {
  const { data, error } = useStats({ variant });
  // 确保 SSR 和客户端首次渲染一致（都显示骨架屏）
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // 地理数据处理 - 使用可选链避免空值错误
  const geoCountries = data?.geo?.countries || [];

  // 以下计算在 data 存在时才会执行，使用 useMemo 缓存结果
  // 注意：useMemo 必须在所有条件 return 之前调用，违反 Hooks 规则会导致崩溃
  const { worldMapData, maxGeoViews } = useMemo(() => {
    const maxViews = Math.max(...geoCountries.map((c) => c.views), 1);

    // 国际地图数据
    // HK/TW/MO 已合并到中国（world-zh.json 中无独立条目），将数据归入 CN
    const MERGE_TO_CN = new Set(['HK', 'TW', 'MO']);
    const worldData: Record<string, { views: number; uv: number; name: string }> = {};
    for (const c of geoCountries) {
      const country = MERGE_TO_CN.has(c.country) ? 'CN' : c.country;
      const numeric = ALPHA2_TO_NUMERIC[country];
      // 使用中文国名匹配 world-zh.json 中的 properties.name
      const zhName = ALPHA2_TO_ZH_NAME[country] || country;
      if (!numeric) continue;
      if (worldData[numeric]) {
        // 合并数据（如 HK+TW+MO → CN）
        worldData[numeric].views += c.views;
        worldData[numeric].uv += c.uniqueVisitors;
      } else {
        worldData[numeric] = { views: c.views, uv: c.uniqueVisitors, name: zhName };
      }
    }

    return { worldMapData: worldData, maxGeoViews: maxViews };
  }, [geoCountries]);

  if (error) {
    return (
      <div className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center text-sm text-[var(--sf-ink-2)]">
        统计数据暂时不可用，请稍后再试。
      </div>
    );
  }

  // SSR 和客户端首次渲染都显示骨架屏，避免 hydration 不匹配
  if (!mounted || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-[3px]" />
        ))}
      </div>
    );
  }

  const readouts = [
    { label: '总访问量', value: data.totalViews },
    { label: '今日访问', value: data.todayViews },
    { label: '独立访客（30天）', value: data.uniqueVisitors },
    { label: '统计天数', value: data.daily.length },
  ];
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.views));

  return (
    <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="visible" className="space-y-6">
      {/* 数字读数 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {readouts.map((readout) => (
          <motion.div
            key={readout.label}
            variants={fadeUp}
            className="relative overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 transition-colors hover:border-[var(--sf-line-strong)]"
          >
            <span className="absolute left-0 top-0 h-px w-10 bg-[var(--sf-accent)]" aria-hidden="true" />
            <div className="font-mono text-3xl font-bold leading-none tracking-tight text-[var(--sf-ink)] tabular-nums">
              <CountUp to={readout.value} duration={1.2} />
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sf-ink-3)]">{readout.label}</div>
          </motion.div>
        ))}
      </div>

      {/* 30 天趋势（自绘 SVG 柱状图） */}
      <motion.div variants={fadeUp} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-[var(--sf-ink)]">近 30 天访问趋势</h3>
        {data.daily.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--sf-ink-3)]">暂无数据</p>
        ) : (
          <svg viewBox={`0 0 ${data.daily.length * 12} 120`} className="h-28 w-full" role="img" aria-label="近30天每日访问量柱状图">
            {data.daily.map((d, i) => {
              const h = Math.max(2, Math.round((d.views / maxDaily) * 100));
              return (
                <rect
                  key={d.date}
                  x={i * 12 + 1}
                  y={110 - h}
                  width={10}
                  height={h}
                  rx={2}
                  tabIndex={0}
                  aria-label={`${d.date}：${d.views} 次访问`}
                  className="fill-[var(--sf-accent)] opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none"
                >
                  <title>{`${d.date}：${d.views} 次访问`}</title>
                </rect>
              );
            })}
          </svg>
        )}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 热门页面 */}
        <motion.div variants={fadeUp} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-[var(--sf-ink)]">热门页面 Top 10</h3>
          <ol className="divide-y divide-[var(--sf-line-soft)] text-sm">
            {data.topPages.length === 0 && <li className="text-[var(--sf-ink-3)]">暂无数据</li>}
            {data.topPages.map((p, i) => (
              <li key={p.path} className="flex items-baseline gap-3 py-2">
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-[var(--sf-ink-3)] tabular-nums">{i + 1}</span>
                <a href={safeHref(p.path)} className="min-w-0 flex-1 truncate text-[var(--sf-ink-2)] no-underline transition-colors hover:text-[var(--sf-accent-ink)]">{p.path}</a>
                <span className="shrink-0 font-mono text-[11px] text-[var(--sf-ink-3)] tabular-nums">{p.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* 来源 */}
        <motion.div variants={fadeUp} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-[var(--sf-ink)]">访问来源 Top 10</h3>
          <ol className="divide-y divide-[var(--sf-line-soft)] text-sm">
            {data.topReferrers.length === 0 && <li className="text-[var(--sf-ink-3)]">暂无数据</li>}
            {data.topReferrers.map((r, i) => (
              <li key={r.referrer} className="flex items-baseline gap-3 py-2">
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-[var(--sf-ink-3)] tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--sf-ink-2)]">{r.referrer}</span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--sf-ink-3)] tabular-nums">{r.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>
      </div>

      {/* 访客地理分布 - 所有变体都显示 */}
      {geoCountries.length > 0 && (
        <motion.div variants={fadeUp} className="overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold tracking-tight text-[var(--sf-ink)]">访客地理分布</h3>
              <p className="mt-1.5 text-xs text-[var(--sf-ink-2)]">每一次到访，都在这里留下足迹。</p>
            </div>
            <span className="text-xs text-[var(--sf-ink-3)]"><b className="mr-1 font-mono text-base font-medium text-[var(--sf-accent)] tabular-nums">{Object.keys(worldMapData).length}</b> 个国家 / 地区</span>
          </div>
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            {/* 地图 */}
            <DualModeGeoMap
              worldData={worldMapData}
            />
            {/* 排名 */}
            <div className="min-w-0 border-t border-[var(--sf-line-soft)] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-2">
              <div className="mb-5 flex items-baseline justify-between gap-2">
                <h4 className="text-xs font-semibold text-[var(--sf-ink-2)]">到访最多的地方</h4>
                <span className="font-mono text-[9px] tracking-wider text-[var(--sf-ink-3)]">TOP 10</span>
              </div>
              <div className="space-y-5">
                {geoCountries.slice(0, 10).map((c, i) => (
                  <div key={`${c.country}-${i}`} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] text-[var(--sf-ink-3)] tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-medium text-[var(--sf-ink)]">{ALPHA2_TO_ZH_NAME[c.country] || c.country}</span>
                        <span className="ml-2 shrink-0 font-mono text-[11px] text-[var(--sf-ink-2)] tabular-nums">
                          {c.views.toLocaleString()} <span className="font-sans text-[10px] text-[var(--sf-ink-3)]">次</span>
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden bg-[var(--sf-line-soft)]">
                        <div
                          className="h-full bg-[var(--sf-accent)]"
                          style={{ width: `${(c.views / maxGeoViews) * 100}%` }}
                        />
                      </div>
                      <div className="mt-1.5 text-[10px] text-[var(--sf-ink-3)]">
                        <span className="font-mono tabular-nums">{c.uniqueVisitors.toLocaleString()}</span> 位独立访客
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* admin 变体：UA 分类分布 */}
      {variant === 'admin' && data.detail && (
        <motion.div variants={fadeUp} className="rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-[var(--sf-ink)]">设备分布（30 天）</h3>
          <div className="flex flex-wrap gap-2">
            {data.detail.uaCategories.map((c) => (
              <span key={c.category} className="inline-flex items-center rounded-[2px] border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-2.5 py-1 text-[11px] text-[var(--sf-ink-2)]">
                {CATEGORY_LABELS[c.category] || c.category}{' '}
                <span className="font-mono text-[var(--sf-ink-3)] tabular-nums">· {c.views}</span>
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
