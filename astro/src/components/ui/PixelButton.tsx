import React from 'react';
import './PixelButton.css';

interface PixelButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
  className?: string;
}

/**
 * 共享主操作按钮。
 *
 * 外壳 + 内层 button 两层结构保留，但不再挂载 PixelCard 的 canvas 像素层：
 * 视觉全部交给 global.css 的 `--sf-*` 令牌（浅色画布 / 冷灰细线 / 唯一强调色），
 * 主按钮 = `--sf-accent` 背景 + `--sf-on-accent` 前景，深浅主题各自可读。
 * props 与提交语义（type / onClick / disabled / loading / variant / className）
 * 与改造前完全一致，调用点无需改动。
 */
export default function PixelButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  loading = false,
  variant = 'primary',
  className = '',
}: PixelButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <div
      className={`pixel-btn ${variant === 'secondary' ? 'pixel-btn--secondary' : 'pixel-btn--primary'} ${isDisabled ? 'pixel-btn--disabled' : ''} ${className}`.trim()}
    >
      <button
        type={type}
        onClick={onClick}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className="pixel-btn__inner"
      >
        {loading && (
          <svg
            className="pixel-btn__spinner"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    </div>
  );
}
