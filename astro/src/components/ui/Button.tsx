import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * Button 变体类型
 */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

/**
 * 按钮变体样式映射
 *
 * 全部落到 global.css 的 `--sf-*` 令牌：唯一强调色 + 冷灰细线 + 表面色，
 * 深浅主题由 `.dark` 覆写令牌整体切换，组件内不再写死配色。
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--sf-accent)] text-[var(--sf-on-accent,var(--sf-canvas))] hover:bg-[var(--sf-accent-ink)]',
  secondary:
    'border border-[var(--sf-line-control)] bg-[var(--sf-surface)] text-[var(--sf-ink)] hover:border-[var(--sf-line-strong)]',
  ghost: 'bg-transparent text-[var(--sf-ink-2)] hover:bg-[var(--sf-line-soft)] hover:text-[var(--sf-ink)]',
  outline:
    'border border-[var(--sf-line-control)] bg-transparent text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]',
};

/**
 * 按钮尺寸映射
 */
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm sm:text-base',
  lg: 'px-4 py-2.5 text-base sm:px-6 sm:py-3 sm:text-lg',
};

/**
 * 按钮组件
 * 支持多种变体、尺寸和加载状态
 * 保留悬停/点击的轻微缩放，但幅度收敛到几乎不可察觉，符合克制动效
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      // 悬停时轻微放大（克制）
      whileHover={{ scale: 1.01 }}
      // 点击时轻微缩小
      whileTap={{ scale: 0.99 }}
      // 过渡动画配置
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={cn(
        // 基础样式
        'inline-flex min-h-[44px] min-w-[44px] max-w-full items-center justify-center rounded-[3px] font-medium sm:min-h-[40px] sm:min-w-[40px]',
        'whitespace-normal break-words text-center leading-snug',
        'transition-colors duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sf-canvas)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // 变体样式
        variantStyles[variant],
        // 尺寸样式
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {/* 加载状态显示旋转图标 */}
      {loading && (
        <svg
          className="mr-2 h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
