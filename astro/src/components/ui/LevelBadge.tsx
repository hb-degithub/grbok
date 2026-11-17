import React from 'react';
import { cn } from '../../lib/utils';

interface LevelBadgeProps {
  level: number;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}

/**
 * 等级徽标。
 *
 * 分级数据（名称 / 图标 / 档位）保持原样，只把「配色」从 zinc/blue/purple/red 调色板
 * 换成共享令牌：细线描边 + 实底表面 + 单一强调色，深浅主题由 `.dark` 覆写令牌自动切换。
 * 可辨识性不靠彩色填充，而靠「描边强度 → 强调色 → 警告 → 危险」的语义梯度叠加原有 emoji 图标：
 *   1 注册用户 冷灰细线 / 弱化文字
 *   2 活跃用户 控制线 / 常规文字
 *   3 资深用户 唯一强调色
 *   4 VIP 会员 警告 amber（语义色保留，优先于统一色板）
 *   5 荣誉会员 语义红 --sf-danger
 */
const LEVEL_CONFIG: Record<number, { name: string; icon: string; color: string; bgColor: string }> = {
  1: { name: '注册用户', icon: '⚪', color: 'text-[var(--sf-ink-3)]', bgColor: 'border-[var(--sf-line)] bg-[var(--sf-surface)]' },
  2: { name: '活跃用户', icon: '🔵', color: 'text-[var(--sf-ink-2)]', bgColor: 'border-[var(--sf-line-control)] bg-[var(--sf-surface)]' },
  3: { name: '资深用户', icon: '🟣', color: 'text-[var(--sf-accent-ink)]', bgColor: 'border-[var(--sf-accent)] bg-[var(--sf-surface)]' },
  4: { name: 'VIP会员', icon: '🟡', color: 'text-amber-700 dark:text-amber-400', bgColor: 'border-amber-500 bg-[var(--sf-surface)] dark:border-amber-400' },
  5: { name: '荣誉会员', icon: '🔴', color: 'text-[var(--sf-danger)]', bgColor: 'border-[var(--sf-danger)] bg-[var(--sf-surface)]' },
};

const SIZE_CONFIG = {
  sm: { icon: 'text-xs', text: 'text-xs', padding: 'px-1.5 py-0.5' },
  md: { icon: 'text-sm', text: 'text-sm', padding: 'px-2 py-1' },
  lg: { icon: 'text-base', text: 'text-base', padding: 'px-3 py-1.5' },
};

export default function LevelBadge({ level, size = 'md', showName = false, className }: LevelBadgeProps) {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-[2px] border font-medium leading-snug',
        config.bgColor,
        config.color,
        sizeConfig.padding,
        className
      )}
      title={config.name}
    >
      <span className={sizeConfig.icon}>{config.icon}</span>
      {showName && <span className={cn('min-w-0 break-words', sizeConfig.text)}>{config.name}</span>}
    </span>
  );
}
