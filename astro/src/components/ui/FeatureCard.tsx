import { useId, useState } from 'react';

export interface FeatureDetail {
  title: string;
  desc: string;
  detail: string;
  points?: string[];
}

interface FeatureCardProps {
  feature: FeatureDetail;
  /**
   * 可选显式 id（about 页按索引传入 `feature-${index}`）。
   *
   * 每个 Astro `client:*` 岛屿都是独立的 React root，`useId` 只保证同一个
   * root 内唯一：独立岛屿各自从 `_R_0_` 重新计数，默认 id 会重复。
   * 传入 id 时详情容器 id 为 `feature-detail-${id}`，未传则回退 useId。
   */
  id?: string;
}

/**
 * 功能特性卡片：与 TechCard 同一交互模型 —— 标题行是原生 `button`，
 * 桌面与触屏统一「点击内联展开/收起」详情。
 *
 * 旧实现把桌面详情放在 `absolute bottom-full` 的 `role="tooltip"` 浮层里，
 * 只能靠 `hover` 悬停看到（触屏另走点击分支），既无法键盘触发，也没有
 * `aria-expanded` / `aria-controls` 状态关联；两个分支还会各渲染一份详情。
 *
 * 现在详情容器始终挂载，用 grid-template-rows 0fr ↔ 1fr 过渡展开/收起，
 * `aria-expanded` / `aria-controls` / `aria-hidden` 同步。标题仍放在 `h3` 里
 * 以保留文档大纲，焦点环用 `ring-inset` 避免被卡片边框裁切。
 *
 * id：调用方传入 `id` 时详情容器 id 为 `feature-detail-${id}`；未传则回退
 * useId（保证同一个 React root 内 SSR/CSR 一致）。注意 useId 只在单个 root 内
 * 唯一，Astro 每个 `client:*` 岛屿是独立 root，跨岛屿必须传显式 id。
 */
export default function FeatureCard({ feature, id }: FeatureCardProps) {
  const [open, setOpen] = useState(false);
  // 清洗 useId 成 CSS 选择器安全的后缀；显式 id 原样使用以保持契约可预测。
  const fallbackId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const panelId = `feature-detail-${id ?? fallbackId}`;

  return (
    <div className="h-full rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)]">
      <h3 className="font-mono text-sm font-semibold text-[var(--sf-ink)]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={`flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-[3px] px-3 py-2.5 text-left transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-inset focus-visible:outline-none ${
            open
              ? 'bg-[var(--sf-canvas)] text-[var(--sf-accent-ink)]'
              : 'text-[var(--sf-ink)] hover:bg-[var(--sf-canvas)]'
          }`}
        >
          <span className="min-w-0 flex-1 break-words">{feature.title}</span>
          {/* 展开指示箭头：随 open 旋转 */}
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
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
      </h3>

      <p className="px-3 pb-3 text-xs leading-relaxed text-[var(--sf-ink-3)]">{feature.desc}</p>

      {/* 内联详情：始终挂载，0fr ↔ 1fr 折叠；内层 min-height:0 + overflow 裁剪避免撑开网格 */}
      <div
        id={panelId}
        aria-hidden={!open}
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <div className="border-t border-[var(--sf-line)] px-3 py-3">
            <p className="mb-2 text-xs leading-relaxed text-[var(--sf-ink-2)]">{feature.detail}</p>
            {feature.points && feature.points.length > 0 && (
              <ul className="space-y-1">
                {feature.points.map((p) => (
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
