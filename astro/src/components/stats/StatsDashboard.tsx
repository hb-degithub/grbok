import React from 'react';
import { motion } from 'framer-motion';
import CountUp from '../reactbits/CountUp';
import { fadeUp, staggerContainer } from '../../lib/motion';
import { useStats } from '../../hooks/domains/useStats';
import GeoMap from './GeoMap';
import { ALPHA2_TO_NUMERIC, PROVINCE_TO_ADCODE } from '../../lib/geoConstants';
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

export default function StatsDashboard({ variant = 'public' }: StatsDashboardProps) {
  const { data, error } = useStats({ variant });

  // 地理数据处理 - 使用可选链避免空值错误
  const geoCountries = data?.geo?.countries || [];
  const geoRegions = data?.geo?.regions || [];

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        统计数据暂时不可用，请稍后再试。
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  // 以下计算在 data 存在时才会执行，使用 useMemo 缓存结果
  const maxGeoViews = Math.max(...geoCountries.map((c) => c.views), 1);

  // 国际地图数据
  const worldMapData: Record<string, { views: number; uv: number; name: string }> = {};
  for (const c of geoCountries) {
    const numeric = ALPHA2_TO_NUMERIC[c.country];
    if (numeric) worldMapData[numeric] = { views: c.views, uv: c.uniqueVisitors, name: c.country };
  }

  // 中国地图数据（按省份聚合）
  const chinaMapData: Record<string, { views: number; uv: number; name: string }> = {};
  const provinceMap: Record<string, { views: number; uv: number }> = {};
  
  // 从 regions 数据聚合中国各省份
  for (const r of geoRegions) {
    if (r.country === 'CN' && r.region) {
      const prov = r.region;
      if (!provinceMap[prov]) provinceMap[prov] = { views: 0, uv: 0 };
      provinceMap[prov].views += r.views;
      provinceMap[prov].uv += r.uniqueVisitors;
    }
  }
  
  for (const [prov, provData] of Object.entries(provinceMap)) {
    const adcode = PROVINCE_TO_ADCODE[prov];
    if (adcode) chinaMapData[adcode] = { views: provData.views, uv: provData.uv, name: prov };
  }

  const cards = [
    { label: '总访问量', value: data.totalViews },
    { label: '今日访问', value: data.todayViews },
    { label: '独立访客（30天）', value: data.uniqueVisitors },
    { label: '统计天数', value: data.daily.length },
  ];
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.views));

  return (
    <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="visible" className="space-y-6">
      {/* 数字卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <motion.div
            key={card.label}
            variants={fadeUp}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-3xl font-black text-zinc-950 dark:text-zinc-50">
              <CountUp to={card.value} duration={1.2} />
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* 30 天趋势（自绘 SVG 柱状图） */}
      <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">近 30 天访问趋势</h3>
        {data.daily.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">暂无数据</p>
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
                  className="fill-teal-500/70 transition-colors hover:fill-teal-500 dark:fill-teal-400/70 dark:hover:fill-teal-400"
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
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">热门页面 Top 10</h3>
          <ol className="space-y-2 text-sm">
            {data.topPages.length === 0 && <li className="text-zinc-400">暂无数据</li>}
            {data.topPages.map((p, i) => (
              <li key={p.path} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                <a href={p.path} className="min-w-0 flex-1 truncate text-zinc-700 no-underline hover:text-teal-600 dark:text-zinc-300 dark:hover:text-teal-400">{p.path}</a>
                <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{p.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* 来源 */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">访问来源 Top 10</h3>
          <ol className="space-y-2 text-sm">
            {data.topReferrers.length === 0 && <li className="text-zinc-400">暂无数据</li>}
            {data.topReferrers.map((r, i) => (
              <li key={r.referrer} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{r.referrer}</span>
                <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.views}</span>
              </li>
            ))}
          </ol>
        </motion.div>
      </div>

      {/* 访客地理分布 - 仅 admin 变体显示 */}
      {variant === 'admin' && geoCountries.length > 0 && (
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">访客地理分布</h3>
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            {/* 地图 */}
            <GeoMap
              worldData={worldMapData}
              chinaData={chinaMapData}
              maxViews={maxGeoViews}
            />
            {/* 排名 */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">国家/地区 TOP 10</h4>
              <div className="space-y-2">
                {geoCountries.slice(0, 10).map((c, i) => (
                  <div key={c.country} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.country}</span>
                        <span className="ml-2 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                          {c.views} 次 / {c.uniqueVisitors} 人
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-teal-500 transition-all"
                          style={{ width: `${(c.views / maxGeoViews) * 100}%` }}
                        />
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
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">设备分布（30 天）</h3>
          <div className="flex flex-wrap gap-3">
            {data.detail.uaCategories.map((c) => (
              <span key={c.category} className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {CATEGORY_LABELS[c.category] || c.category} · {c.views}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
