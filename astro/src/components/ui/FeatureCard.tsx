import { useState } from 'react';

export interface FeatureDetail {
  title: string;
  desc: string;
  detail: string;
  points?: string[];
}

interface FeatureCardProps {
  feature: FeatureDetail;
}

/**
 * 功能特性卡片：桌面端 hover 显示悬浮详情，移动端点击展开内联详情。
 * 与 TechCard 同一交互模式，布局适配标题+描述的功能条目。
 */
export default function FeatureCard({ feature }: FeatureCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="group relative"
      onClick={() => {
        if (window.matchMedia('(hover: none)').matches) {
          setOpen((v) => !v);
        }
      }}
    >
      <div className="cursor-pointer">
        <h3 className="mb-1 flex items-center gap-1.5 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {feature.title}
          <svg
            className={`h-3 w-3 shrink-0 transition-all duration-200 ${
              open ? 'rotate-180 text-teal-500' : 'text-zinc-300 group-hover:text-teal-500 dark:text-zinc-600'
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </h3>
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{feature.desc}</p>
      </div>

      {/* 桌面端：hover 悬浮详情卡 */}
      <div
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-72 translate-y-1 rounded-lg border border-zinc-200/80 bg-white/95 p-4 opacity-0 shadow-lg shadow-zinc-900/5 backdrop-blur-md transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 dark:border-zinc-700/60 dark:bg-zinc-900/95 dark:shadow-black/20 [@media(hover:hover)]:block"
        role="tooltip"
      >
        <p className="mb-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{feature.detail}</p>
        {feature.points && feature.points.length > 0 && (
          <ul className="space-y-1">
            {feature.points.map((p) => (
              <li key={p} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className="absolute top-full left-6 border-8 border-transparent border-t-white/95 dark:border-t-zinc-900/95" />
      </div>

      {/* 移动端：点击展开内联详情 */}
      {open && (
        <div className="mt-2 rounded-md border border-teal-500/20 bg-teal-500/5 p-3 [@media(hover:hover)]:hidden">
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{feature.detail}</p>
          {feature.points && feature.points.length > 0 && (
            <ul className="mt-2 space-y-1">
              {feature.points.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
