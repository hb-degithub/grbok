import { useState } from 'react';

export interface TechDetail {
  name: string;
  desc: string;
  detail: string;
  points?: string[];
}

interface TechCardProps {
  tech: TechDetail;
}

/**
 * 技术栈卡片：桌面端 hover 显示悬浮详情，移动端点击展开内联详情。
 * hover 态用纯 CSS（group-hover + hover:hover 媒体查询），点击展开仅在不支持 hover 的设备生效。
 */
export default function TechCard({ tech }: TechCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="group relative"
      onClick={() => {
        // 仅在无 hover 能力的设备（触屏）上响应点击展开
        if (window.matchMedia('(hover: none)').matches) {
          setOpen((v) => !v);
        }
      }}
    >
      <div
        className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 ${
          open
            ? 'border-teal-500/40 bg-teal-500/5'
            : 'border-zinc-200 hover:border-teal-500/30 dark:border-zinc-700/50'
        }`}
      >
        <span className="font-mono text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-zinc-100">
          {tech.name}
        </span>
        <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">{tech.desc}</span>
        {/* 提示图标：有详情时显示 */}
        <svg
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-all duration-200 ${
            open ? 'rotate-180 text-teal-500' : 'text-zinc-300 group-hover:text-teal-500 dark:text-zinc-600'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* 桌面端：hover 悬浮详情卡 */}
      <div
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 -translate-x-1/2 translate-y-1 rounded-lg border border-zinc-200/80 bg-white/95 p-4 opacity-0 shadow-lg shadow-zinc-900/5 backdrop-blur-md transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 dark:border-zinc-700/60 dark:bg-zinc-900/95 dark:shadow-black/20 [@media(hover:hover)]:block"
        role="tooltip"
      >
        <p className="mb-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{tech.detail}</p>
        {tech.points && tech.points.length > 0 && (
          <ul className="space-y-1">
            {tech.points.map((p) => (
              <li key={p} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                {p}
              </li>
            ))}
          </ul>
        )}
        {/* 小三角 */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white/95 dark:border-t-zinc-900/95" />
      </div>

      {/* 移动端：点击展开内联详情 */}
      {open && (
        <div className="mt-2 rounded-md border border-teal-500/20 bg-teal-500/5 p-3 [@media(hover:hover)]:hidden">
          <p className="mb-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{tech.detail}</p>
          {tech.points && tech.points.length > 0 && (
            <ul className="space-y-1">
              {tech.points.map((p) => (
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
