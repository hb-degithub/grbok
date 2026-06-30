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
 *
 * 设计决策：
 * 1. 无障碍：label 通过 htmlFor 与 input 关联；错误时自动设置
 *    aria-invalid 与 aria-describedby，屏幕阅读器可定位错误原因。
 * 2. 焦点：用 focus-visible 而非 focus，保证纯键盘操作时显示焦点环，
 *    鼠标点击不残留蓝环，符合 WCAG 2.4.7。
 * 3. 玻璃适配：半透明背景 + 聚焦时边框/光晕强化，在玻璃卡片上保持可读。
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
  const errorId = inputId ? `${inputId}-error` : undefined;
  const helperId = inputId ? `${inputId}-helper` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block break-words text-sm font-medium leading-snug text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
      )}

      <motion.div whileFocus={{ scale: 1.005 }} transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'min-h-[40px] w-full min-w-0 rounded-xl border px-3 py-2.5 text-[16px] leading-snug sm:px-4 sm:text-sm',
            'bg-white/70 text-zinc-900 placeholder-zinc-400',
            'transition-all duration-200 ease-out',
            error
              ? 'border-red-400 focus-visible:border-red-500'
              : 'border-zinc-200 focus-visible:border-zinc-500 dark:border-zinc-700 dark:focus-visible:border-zinc-400',
            'outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 focus-visible:ring-offset-0',
            'dark:bg-zinc-900/50 dark:text-zinc-100 dark:placeholder-zinc-500',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      </motion.div>

      {/* 错误提示 - role="alert" 即时播报 */}
      {error && (
        <motion.p
          id={errorId}
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1.5 flex items-start gap-1.5 break-words text-sm leading-snug text-red-600 dark:text-red-400"
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {error}
        </motion.p>
      )}

      {/* 帮助文本 */}
      {helperText && !error && (
        <p id={helperId} className="mt-1.5 break-words text-sm leading-snug text-zinc-500 dark:text-zinc-400">
          {helperText}
        </p>
      )}
    </div>
  );
}
