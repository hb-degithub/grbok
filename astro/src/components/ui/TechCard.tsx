import { useId, useState } from 'react';

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
 * 技术栈卡片：桌面与触屏统一「点击内联展开/收起」详情。
 *
 * 旧实现把详情放在 absolute 浮层里 hover 展示，被外层 GlareHover 的
 * `overflow: hidden` 裁切；桌面点击又被 `(hover: none)` 排除，导致详情不可达。
 * 现在紧凑行是原生 button（Enter/Space 可激活），详情始终挂载在按钮下方，
 * 用 grid-template-rows 0fr ↔ 1fr 过渡展开/收起，aria-expanded / aria-controls
 * 与容器 aria-hidden 同步。
 *
 * 键盘焦点环使用 `ring-inset`：外层 GlareHover 是 `overflow: hidden`，
 * ring-offset 的外扩阴影会被整圈裁掉，改用 inset 阴影保证焦点始终可见。
 */
export default function TechCard({ tech }: TechCardProps) {
  const [open, setOpen] = useState(false);
  // useId 保证 SSR/CSR 一致；清洗成 CSS 选择器安全的 id 供 aria-controls 使用。
  const panelId = `tech-detail-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-inset focus-visible:outline-none ${
          open
            ? 'border-teal-500/40 bg-teal-500/5'
            : 'border-zinc-200 hover:border-teal-500/30 dark:border-zinc-700/50'
        }`}
      >
        <span className="font-mono text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-zinc-100">
          {tech.name}
        </span>
        <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">{tech.desc}</span>
        {/* 展开指示箭头：随 open 旋转 */}
        <svg
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-all duration-200 ${
            open ? 'rotate-180 text-teal-500' : 'text-zinc-300 dark:text-zinc-600'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 内联详情：始终挂载，0fr ↔ 1fr 折叠；内层 min-height:0 + overflow 裁剪避免撑开网格 */}
      <div
        id={panelId}
        aria-hidden={!open}
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <div className="mt-2 rounded-md border border-teal-500/20 bg-teal-500/5 p-3">
            <p className="mb-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{tech.detail}</p>
            {tech.points && tech.points.length > 0 && (
              <ul className="space-y-1">
                {tech.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
