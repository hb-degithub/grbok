import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';

interface InputProps extends Omit<HTMLMotionProps<'input'>, 'ref'> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * 输入框组件
 * 使用 Framer Motion 实现聚焦时的微动画
 */
export default function Input({
  label,
  error,
  helperText,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="w-full">
      {/* 标签 */}
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
      )}

      {/* 输入框容器 */}
      <motion.div
        // 聚焦时轻微放大
        whileFocus={{ scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      >
        <input
          id={inputId}
          className={cn(
            // 基础样式
            'w-full rounded-lg border px-4 py-2.5',
            'bg-white text-gray-900 placeholder-gray-400',
            'transition-all duration-200',
            // 边框和阴影
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:focus:border-blue-400',
            // 深色模式
            'dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500',
            // 聚焦状态
            'focus:outline-none focus:ring-2 focus:ring-offset-1',
            // 禁用状态
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      </motion.div>

      {/* 错误提示 */}
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1.5 text-sm text-red-500"
        >
          {error}
        </motion.p>
      )}

      {/* 帮助文本 */}
      {helperText && !error && (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
          {helperText}
        </p>
      )}
    </div>
  );
}
