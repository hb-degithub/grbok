import React from 'react';
import { cn } from '../../lib/utils';

interface LevelBadgeProps {
  level: number;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}

const LEVEL_CONFIG: Record<number, { name: string; icon: string; color: string; bgColor: string }> = {
  1: { name: '注册用户', icon: '⚪', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'bg-zinc-100 dark:bg-zinc-800' },
  2: { name: '活跃用户', icon: '🔵', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  3: { name: '资深用户', icon: '🟣', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-900/20' },
  4: { name: 'VIP会员', icon: '🟡', color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
  5: { name: '荣誉会员', icon: '🔴', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' },
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
        'inline-flex items-center gap-1 rounded-full font-medium',
        config.bgColor,
        config.color,
        sizeConfig.padding,
        className
      )}
      title={config.name}
    >
      <span className={sizeConfig.icon}>{config.icon}</span>
      {showName && <span className={sizeConfig.text}>{config.name}</span>}
    </span>
  );
}
