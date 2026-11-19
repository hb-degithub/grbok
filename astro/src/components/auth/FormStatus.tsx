import React from 'react';

/**
 * 认证表单的表单级状态（错误 / 警告 / 成功 / 信息）。
 *
 * 为什么单独抽出来：改造前每个表单把「服务端错误、限流锁定、字段校验失败」
 * 都塞进第一个 Input 的 error 插槽，读屏用户会以为只有邮箱填错了。
 * 现在字段错误仍由 Input 的 aria-invalid / aria-describedby 就近呈现，
 * 表单级结果统一走这里，放在提交按钮上方。
 *
 * 颜色只使用 global.css 的 --sf-* 语义令牌，深浅主题自动切换。
 */
export type FormStatusTone = 'error' | 'warning' | 'success' | 'info';

interface FormStatusProps {
  message?: string | null;
  tone?: FormStatusTone;
  id?: string;
  className?: string;
}

const TONE_CLASS: Record<FormStatusTone, string> = {
  error: 'border-[var(--sf-danger)] text-[var(--sf-danger)]',
  warning: 'border-[var(--sf-warning)] text-[var(--sf-warning)]',
  success: 'border-[var(--sf-success)] text-[var(--sf-success)]',
  info: 'border-[var(--sf-line-control)] text-[var(--sf-info)]',
};

export default function FormStatus({
  message,
  tone = 'error',
  id,
  className = '',
}: FormStatusProps) {
  if (!message) return null;

  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`flex items-start gap-2 rounded-[3px] border bg-[var(--sf-surface)] px-3 py-2 text-sm leading-snug ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M12 9v3m0 3h.01M10.29 3.86l-7.4 12.9A1.5 1.5 0 004.18 19h15.64a1.5 1.5 0 001.29-2.24l-7.4-12.9a1.5 1.5 0 00-2.58 0z"
        />
      </svg>
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}
