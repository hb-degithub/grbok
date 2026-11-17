import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'ref'> {
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
 *    鼠标点击不残留焦点描边，符合 WCAG 2.4.7。
 * 3. 科幻简约：表面色 + 冷灰控制线（`--sf-line-control`），聚焦时换成唯一强调色；
 *    深浅主题由 `.dark` 覆写 `--sf-*` 令牌，组件内不写死配色。
 *    错误红保留为语义色（可辨识优先于统一色板）。
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
          className="mb-1.5 block break-words text-sm font-medium leading-snug text-[var(--sf-ink-2)]"
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
            'min-h-[40px] w-full min-w-0 rounded-[3px] border px-3 py-2.5 text-[16px] leading-snug sm:px-4 sm:text-sm',
            'bg-[var(--sf-surface)] text-[var(--sf-ink)] placeholder:text-[var(--sf-ink-3)]',
            'transition-colors duration-200 ease-out',
            error
              ? 'border-red-500 focus-visible:border-red-600 focus-visible:ring-red-500/40'
              : 'border-[var(--sf-line-control)] focus-visible:border-[var(--sf-accent)] focus-visible:ring-[var(--sf-accent)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
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
        <p id={helperId} className="mt-1.5 break-words text-sm leading-snug text-[var(--sf-ink-3)]">
          {helperText}
        </p>
      )}
    </div>
  );
}
