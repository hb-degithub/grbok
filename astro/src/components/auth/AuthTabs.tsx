import React, { useRef } from 'react';

export interface AuthTabItem<T extends string = string> {
  id: T;
  label: string;
}

interface AuthTabsProps<T extends string> {
  items: ReadonlyArray<AuthTabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** tab / panel 的 id 前缀，AuthPage 用同一前缀生成 tabpanel。 */
  idPrefix?: string;
  ariaLabel?: string;
  className?: string;
}

/** tab 的稳定 id（由 AuthTabs 与 tabpanel 共用同一约定）。 */
export function authTabId(id: string, prefix = 'auth'): string {
  return `${prefix}-tab-${id}`;
}

/** tabpanel 的稳定 id（与对应 tab 的 aria-controls 一致）。 */
export function authPanelId(id: string, prefix = 'auth'): string {
  return `${prefix}-panel-${id}`;
}

/**
 * 认证方式切换 tablist（WAI-ARIA Tabs · 自动激活）。
 *
 * - roving tabindex：仅选中项可 Tab 到达，其余 -1；
 * - ArrowLeft / ArrowRight 循环切换，Home / End 跳到首尾，焦点随选中项移动；
 * - 每个 tab 带 aria-controls 指向 tabpanel，tabpanel 用 aria-labelledby 回指；
 * - 只负责交互与语义，视觉沿用全站 --sf-* 令牌。
 */
export default function AuthTabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix = 'auth',
  ariaLabel = '认证方式',
  className = '',
}: AuthTabsProps<T>) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const moveTo = (index: number) => {
    const next = items[index];
    if (!next) return;
    onChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const length = items.length;
    if (!length) return;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveTo((index + 1) % length);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveTo((index - 1 + length) % length);
        return;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        return;
      case 'End':
        event.preventDefault();
        moveTo(length - 1);
        return;
      default:
        return;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`grid grid-cols-3 border border-[var(--sf-line)] bg-[var(--sf-canvas)] ${className}`.trim()}
    >
      {items.map((item, index) => {
        const selected = item.id === value;

        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            id={authTabId(item.id, idPrefix)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={authPanelId(item.id, idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`focus-ring relative flex min-h-[44px] items-center justify-center border-b-2 px-1.5 py-2 text-center text-[13px] font-medium leading-tight transition-colors duration-150 sm:px-2 sm:text-sm ${
              selected
                ? 'border-b-[var(--sf-accent)] text-[var(--sf-ink)]'
                : 'border-b-transparent text-[var(--sf-ink-3)] hover:text-[var(--sf-ink-2)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
