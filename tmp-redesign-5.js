const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// AuthPage.tsx - clean design
const authPage = `import React from 'react';
import { motion } from 'framer-motion';
import MagicLinkForm from './MagicLinkForm';
import { SITE_CONFIG } from '../../config/site';

export default function AuthPage() {
  return (
    <section className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-bg px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <div className="card p-8 sm:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-2xl font-bold text-white">
              {SITE_CONFIG.logoText}
            </div>
            <h1 className="text-xl font-semibold text-text">欢迎来到 {SITE_CONFIG.name}</h1>
            <p className="mt-1.5 text-sm text-text-secondary">{SITE_CONFIG.slogan}</p>
          </div>
          <MagicLinkForm />
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 text-center text-sm text-text-muted"
        >
          <a href="/" className="inline-flex items-center gap-1.5 transition-colors hover:text-accent">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回首页
          </a>
        </motion.p>
      </motion.div>
    </section>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'auth', 'AuthPage.tsx'), authPage);
console.log('Created AuthPage.tsx');

// MagicLinkForm.tsx - clean design
const magicLink = `import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePocketBase } from '../../hooks/usePocketBase';
import Button from '../ui/Button';
import Input from '../ui/Input';

type FormStatus = 'idle' | 'loading' | 'sent' | 'verifying' | 'error';

export default function MagicLinkForm() {
  const [email, setEmail] = useState('');
  const [otpId, setOtpId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { requestMagicLink, verifyMagicLink } = usePocketBase();

  const isValidEmail = (value: string) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);

  const reset = () => {
    setOtpId('');
    setOtpCode('');
    setStatus('idle');
    setErrorMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setStatus('error'); setErrorMessage('请输入邮箱地址'); return; }
    if (!isValidEmail(email)) { setStatus('error'); setErrorMessage('邮箱格式不正确'); return; }

    setStatus('loading');
    setErrorMessage('');
    const { success, otpId: nextOtpId, error } = await requestMagicLink(email.trim().toLowerCase());

    if (success && nextOtpId) {
      setOtpId(nextOtpId);
      setStatus('sent');
    } else {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '发送失败，请稍后重试');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) { setStatus('error'); setErrorMessage('请输入邮件中的一次性验证码'); return; }

    setStatus('verifying');
    setErrorMessage('');
    const { success, error } = await verifyMagicLink(otpId, otpCode);

    if (success) {
      window.location.href = import.meta.env.PUBLIC_ADMIN_ROUTE || '/admin';
      return;
    }
    setStatus('error');
    setErrorMessage(error instanceof Error ? error.message : '验证码无效或已过期');
  };

  return (
    <AnimatePresence mode="wait">
      {otpId ? (
        <motion.form key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={handleVerify} className="space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-text">查收验证码</h3>
            <p className="mt-1 text-sm text-text-secondary">
              我们已向 <span className="font-medium text-accent">{email}</span> 发送一次性登录验证码。
            </p>
          </div>
          <Input label="一次性验证码" type="text" inputMode="numeric" placeholder="输入邮件中的验证码" value={otpCode} onChange={(e) => { setOtpCode(e.target.value); if (status === 'error') setStatus('sent'); }} error={status === 'error' ? errorMessage : undefined} required autoComplete="one-time-code" />
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={reset} className="flex-1">换邮箱</Button>
            <Button type="submit" variant="primary" loading={status === 'verifying'} className="flex-1">{status === 'verifying' ? '验证中...' : '进入后台'}</Button>
          </div>
        </motion.form>
      ) : (
        <motion.form key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={handleSubmit} className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-text">登录 / 注册</h2>
            <p className="mt-1 text-sm text-text-secondary">输入邮箱，我们将发送一次性登录验证码</p>
          </div>
          <Input label="邮箱地址" type="email" placeholder="your@email.com" value={email} onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }} error={status === 'error' ? errorMessage : undefined} required autoComplete="email" />
          <Button type="submit" variant="primary" size="lg" loading={status === 'loading'} className="w-full">{status === 'loading' ? '发送中...' : '发送登录验证码'}</Button>
          <p className="text-center text-xs text-text-muted">后台权限由 PocketBase 角色控制，密码和 token 不写入前端代码</p>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'auth', 'MagicLinkForm.tsx'), magicLink);
console.log('Created MagicLinkForm.tsx');

// Button.tsx - clean design
const button = `import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-bg-soft text-text hover:bg-border',
  ghost: 'text-text-secondary hover:bg-bg-soft hover:text-text',
  outline: 'border border-border bg-surface text-text-secondary hover:border-accent hover:text-accent',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-sm',
};

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
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-all duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="mr-1 h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'ui', 'Button.tsx'), button);
console.log('Created Button.tsx');

// Input.tsx - clean design
const input = `import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';

interface InputProps extends Omit<HTMLMotionProps<'input'>, 'ref'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export default function Input({
  label,
  error,
  helperText,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\\s+/g, '-');
  const errorId = inputId ? \`\${inputId}-error\` : undefined;
  const helperId = inputId ? \`\${inputId}-helper\` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-text">
          {label}
        </label>
      )}
      <motion.div whileFocus={{ scale: 1.005 }} transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'w-full rounded-md border px-4 py-2.5 text-sm',
            'bg-surface text-text placeholder:text-text-muted',
            'transition-all duration-200 ease-out',
            error ? 'border-danger focus-visible:border-danger' : 'border-border focus-visible:border-accent',
            'outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      </motion.div>
      {error && (
        <motion.p id={errorId} role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 flex items-center gap-1.5 text-sm text-danger">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          {error}
        </motion.p>
      )}
      {helperText && !error && <p id={helperId} className="mt-1.5 text-xs text-text-muted">{helperText}</p>}
    </div>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'ui', 'Input.tsx'), input);
console.log('Created Input.tsx');

console.log('Step 8 partial complete');
