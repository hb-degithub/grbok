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
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-zinc-700 text-white shadow-sm shadow-zinc-700/30 hover:bg-zinc-800 active:bg-zinc-900 dark:bg-zinc-600 dark:hover:bg-zinc-700',
  secondary:
    'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  ghost:
    'bg-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  outline:
    'border border-zinc-300 bg-transparent text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800/50',
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
 * 使用 Framer Motion 实现悬停和点击动画
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
      // 悬停时轻微放大
      whileHover={{ scale: 1.02 }}
      // 点击时轻微缩小
      whileTap={{ scale: 0.98 }}
      // 过渡动画配置
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={cn(
        // 基础样式
        'inline-flex min-h-[40px] min-w-[40px] max-w-full items-center justify-center rounded-xl font-medium',
        'whitespace-normal break-words text-center leading-snug',
        'transition-colors duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900',
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
