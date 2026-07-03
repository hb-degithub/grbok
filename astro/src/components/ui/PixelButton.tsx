import React from 'react';
import PixelCard from '../reactbits/PixelCard';
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
    <PixelCard
      className={`pixel-btn ${variant === 'secondary' ? 'pixel-btn--secondary' : ''} ${isDisabled ? 'pixel-btn--disabled' : ''} ${className}`}
      variant={variant === 'primary' ? 'blue' : 'default'}
      gap={variant === 'primary' ? 8 : 6}
      speed={variant === 'primary' ? 30 : 40}
      noFocus={true}
    >
      <button
        type={type}
        onClick={onClick}
        disabled={isDisabled}
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
    </PixelCard>
  );
}