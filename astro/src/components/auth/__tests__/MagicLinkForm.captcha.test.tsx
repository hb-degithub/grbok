import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 邮箱验证码登录（MagicLinkForm）× ALTCHA 人机验证。
 *
 * 只拦截「发送验证码 / 重新发送」这类会触发邮件的动作；
 * 校验验证码（authWithOTP）本身不发邮件，不被人机验证阻塞。
 */

const altcha = vi.hoisted(() => ({
  status: 'pending' as 'pending' | 'blocked' | 'verified' | 'unavailable',
  payload: null as string | null,
  reset: vi.fn(),
}));

const otp = vi.hoisted(() => ({
  requestOTP: vi.fn(),
  authWithOTP: vi.fn(),
}));

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

vi.mock('../../../hooks/usePocketBase', () => ({
  usePocketBase: () => ({
    requestOTP: otp.requestOTP,
    authWithOTP: otp.authWithOTP,
  }),
}));

import MagicLinkForm from '../MagicLinkForm';

function fillEmail(value = 'hb@example.com') {
  fireEvent.change(screen.getByLabelText('邮箱地址', { exact: true }), { target: { value } });
}

function submitForm() {
  const form = document.querySelector('form');
  expect(form, '验证码登录表单未渲染').toBeTruthy();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  altcha.status = 'pending';
  altcha.payload = null;
  altcha.reset.mockClear();
  otp.requestOTP.mockReset();
  otp.authWithOTP.mockReset();
  otp.authWithOTP.mockResolvedValue({ success: false, data: null, error: null });
});

afterEach(cleanup);

describe('MagicLinkForm × ALTCHA', () => {
  it('未验证时“发送验证码”按钮禁用，提交被拦截且不发请求', () => {
    altcha.status = 'blocked';
    render(<MagicLinkForm />);

    const submit = screen.getByRole('button', { name: '发送验证码' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fillEmail();
    submitForm();

    expect(screen.getByRole('alert').textContent).toContain('请先完成人机验证后再提交');
    expect(otp.requestOTP).not.toHaveBeenCalled();
  });

  it('已验证时 payload 随 OTP 请求发送，成功后进入验证码步骤并重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    otp.requestOTP.mockResolvedValue({ data: { otpId: 'otp-1' }, error: null });

    render(<MagicLinkForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(otp.requestOTP).toHaveBeenCalledWith('hb@example.com', 'cGF5bG9hZA==');
    });
    await waitFor(() => expect(screen.getByText('验证码已发送，请查看邮箱并输入收到的验证码。')).toBeTruthy());
    expect(altcha.reset).toHaveBeenCalled();
  });

  it('服务端返回 CAPTCHA_REPLAY：提示“验证已失效”并重新取挑战', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    otp.requestOTP.mockResolvedValue({
      data: null,
      error: { status: 400, response: { code: 'CAPTCHA_REPLAY' } },
    });

    render(<MagicLinkForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('验证已失效，请重新验证');
    });
    expect(altcha.reset).toHaveBeenCalled();
    // 停在邮箱步骤，不误跳到验证码输入
    expect(screen.queryByLabelText('验证码', { exact: true })).toBeNull();
  });

  it('非 CAPTCHA 错误保留原有发送失败文案，且不重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    otp.requestOTP.mockResolvedValue({ data: null, error: { message: 'SMTP offline' } });

    render(<MagicLinkForm />);
    fillEmail();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('SMTP offline');
    });
    expect(altcha.reset).not.toHaveBeenCalled();
  });
});
