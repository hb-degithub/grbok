import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 找回密码表单 × ALTCHA 人机验证。
 *
 * 覆盖：未验证禁用提交 / 已验证 payload 进入请求 / CAPTCHA_EXPIRED 提示与重置 /
 * 非 CAPTCHA 错误与限流响应保持既有文案（不回归）。
 */

const altcha = vi.hoisted(() => ({
  status: 'pending' as 'pending' | 'blocked' | 'verified' | 'unavailable',
  payload: null as string | null,
  reset: vi.fn(),
}));

const mail = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}));

const limiter = vi.hoisted(() => ({ tryConsume: vi.fn(() => true) }));

vi.mock('../AltchaField', async () => {
  const React = await import('react');
  const MockAltchaField = React.forwardRef(function MockAltchaField(
    props: { onVerified?: (payload: string | null) => void; onStatusChange?: (status: string) => void },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({ reset: altcha.reset }));
    React.useEffect(() => {
      props.onStatusChange?.(altcha.status);
      props.onVerified?.(altcha.status === 'verified' ? altcha.payload : null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  });
  return { __esModule: true, default: MockAltchaField };
});

vi.mock('../../../lib/blog-auth-client', () => ({
  requestPasswordReset: mail.requestPasswordReset,
  isAccountMailRateLimited: (response: { accepted?: boolean }) => response?.accepted === false,
}));

vi.mock('../../../lib/security', () => ({
  RateLimiter: class {
    tryConsume = limiter.tryConsume;
  },
}));

import ForgotPasswordForm from '../ForgotPasswordForm';

function fillEmail(value = 'hb@example.com') {
  fireEvent.change(screen.getByLabelText('邮箱', { exact: true }), { target: { value } });
}

function submitForm() {
  const form = document.querySelector('form');
  expect(form, '找回密码表单未渲染').toBeTruthy();
  fireEvent.submit(form as HTMLFormElement);
}

const accepted = {
  accepted: true as const,
  code: 'MAIL_REQUEST_ACCEPTED' as const,
  referenceId: 'ref-1',
};

beforeEach(() => {
  altcha.status = 'pending';
  altcha.payload = null;
  altcha.reset.mockClear();
  mail.requestPasswordReset.mockReset();
  mail.requestPasswordReset.mockResolvedValue(accepted);
  limiter.tryConsume.mockReturnValue(true);
});

afterEach(cleanup);

describe('ForgotPasswordForm × ALTCHA', () => {
  it('未验证时禁用提交按钮，提交被拦截且不发请求', () => {
    altcha.status = 'blocked';
    render(<ForgotPasswordForm />);

    const submit = screen.getByRole('button', { name: '发送重置邮件' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fillEmail();
    submitForm();

    expect(screen.getByRole('alert').textContent).toContain('请先完成人机验证后再提交');
    expect(mail.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('已验证时 payload 作为第二个参数随请求发送，成功后重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    render(<ForgotPasswordForm />);

    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(mail.requestPasswordReset).toHaveBeenCalledWith('hb@example.com', 'cGF5bG9hZA==');
    });
    await waitFor(() => expect(screen.getByText('重置邮件已发送')).toBeTruthy());
    expect(altcha.reset).toHaveBeenCalled();
  });

  it('服务端返回 CAPTCHA_EXPIRED：提示“验证已过期”并重新取挑战', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    mail.requestPasswordReset.mockRejectedValueOnce({ status: 400, response: { code: 'CAPTCHA_EXPIRED' } });

    render(<ForgotPasswordForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('验证已过期，请重新验证');
    });
    expect(altcha.reset).toHaveBeenCalled();
    expect(screen.queryByText('重置邮件已发送')).toBeNull();
  });

  it('非 CAPTCHA 错误保持原有兜底文案，且不重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    mail.requestPasswordReset.mockRejectedValueOnce(new Error('network down'));

    render(<ForgotPasswordForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('请求失败，请稍后重试');
    });
    expect(altcha.reset).not.toHaveBeenCalled();
  });

  it('限流响应（accepted:false）仍按原有「请求过于频繁」提示', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    mail.requestPasswordReset.mockResolvedValueOnce({
      accepted: false,
      code: 'EMAIL_RATE_LIMITED',
      referenceId: 'ref-2',
      retryAfterSeconds: 30,
    });

    render(<ForgotPasswordForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('请求过于频繁');
    });
    expect(screen.getByRole('alert').textContent).toContain('30');
  });
});
