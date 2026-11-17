import { useId, useState } from 'react';

export interface TechDetail {
  name: string;
  desc: string;
  detail: string;
  points?: string[];
}

interface TechCardProps {
  tech: TechDetail;
  /**
   * 可选显式 id（about 页按索引传入 `tech-${index}`）。
   *
   * 每个 Astro `client:*` 岛屿都是独立的 React root，`useId` 只保证同一个
   * root 内唯一：独立岛屿各自从 `_R_0_` 重新计数，默认 id 会重复。
   * 传入 id 时详情容器 id 为 `tech-detail-${id}`，未传则回退 useId。
   */
  id?: string;
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
 * 键盘焦点环使用 `ring-inset`：卡片边框与内部 overflow 裁剪会切掉外扩的
 * ring-offset 阴影，改用 inset 阴影保证焦点始终可见。
 *
 * id：调用方传入 `id` 时详情容器 id 为 `tech-detail-${id}`；未传则回退
 * useId（保证同一个 React root 内 SSR/CSR 一致）。useId 只在单个 root 内唯一，
 * Astro 每个 `client:*` 岛屿是独立 root，跨岛屿必须传显式 id。
 */
export default function TechCard({ tech, id }: TechCardProps) {
  const [open, setOpen] = useState(false);
  // 清洗 useId 成 CSS 选择器安全的后缀；显式 id 原样使用以保持契约可预测。
  const fallbackId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const panelId = `tech-detail-${id ?? fallbackId}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-[3px] border px-3.5 py-2.5 text-left transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-inset focus-visible:outline-none ${
          open
            ? 'border-[var(--sf-accent)] bg-[var(--sf-canvas)]'
            : 'border-[var(--sf-line)] bg-[var(--sf-surface)] hover:border-[var(--sf-line-control)]'
        }`}
      >
        <span className="font-mono text-sm font-semibold whitespace-nowrap text-[var(--sf-ink)]">
          {tech.name}
        </span>
        <span className="truncate text-xs text-[var(--sf-ink-3)]">{tech.desc}</span>
        {/* 展开指示箭头：随 open 旋转 */}
        <svg
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
            open ? 'rotate-180 text-[var(--sf-accent)]' : 'text-[var(--sf-line-control)]'
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
          <div className="mt-2 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] p-3">
            <p className="mb-2 text-xs leading-relaxed text-[var(--sf-ink-2)]">{tech.detail}</p>
            {tech.points && tech.points.length > 0 && (
              <ul className="space-y-1">
                {tech.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--sf-ink-3)]"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--sf-accent)]" />
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
