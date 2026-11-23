import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 注册表单 × ALTCHA 人机验证。
 *
 * AltchaField 用可控替身替代（jsdom 跑不了 PoW）：替身在挂载时上报预设的
 * status / payload，并暴露 `reset` 供断言「服务端拒绝后是否重新取挑战」。
 *
 * 覆盖：
 *   - 未验证：提交按钮禁用 + 提交被拦截 + 中文提示；
 *   - 已验证：base64 payload 进入 registerReader 的请求参数；
 *   - 服务端 CAPTCHA_INVALID / CAPTCHA_UNCONFIGURED：中文提示 + reset。
 */

const altcha = vi.hoisted(() => ({
  status: 'pending' as 'pending' | 'blocked' | 'verified' | 'unavailable',
  payload: null as string | null,
  reset: vi.fn(),
}));

const register = vi.hoisted(() => ({
  registerReader: vi.fn(
    async (_input: unknown): Promise<{ success: boolean; error?: unknown }> => ({ success: true }),
  ),
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
      // 只在挂载时上报一次，测试通过修改 altcha.status 控制初始状态
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  });
  return { __esModule: true, default: MockAltchaField };
});

vi.mock('../../../hooks/usePocketBase', () => ({
  usePocketBase: () => ({ registerReader: register.registerReader }),
}));

vi.mock('../../../lib/security', () => ({
  RateLimiter: class {
    tryConsume = limiter.tryConsume;
  },
}));

import RegisterForm from '../RegisterForm';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('昵称', { exact: true }), { target: { value: 'HB' } });
  fireEvent.change(screen.getByLabelText('邮箱', { exact: true }), { target: { value: 'hb@example.com' } });
  fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('确认密码', { exact: true }), { target: { value: 'password123' } });
}

function submitForm() {
  const form = document.querySelector('form');
  expect(form, '注册表单未渲染').toBeTruthy();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  altcha.status = 'pending';
  altcha.payload = null;
  altcha.reset.mockClear();
  register.registerReader.mockClear();
  register.registerReader.mockResolvedValue({ success: true });
  limiter.tryConsume.mockReturnValue(true);
});

afterEach(cleanup);

describe('RegisterForm × ALTCHA', () => {
  it('未验证时禁用提交按钮，并在提交时给出提示、不发请求', () => {
    altcha.status = 'blocked';
    render(<RegisterForm />);

    const submit = screen.getByRole('button', { name: '提交注册' }) as HTMLButtonElement;
    expect(submit.disabled, '未验证时提交按钮必须禁用').toBe(true);

    fillValidForm();
    submitForm();

    expect(screen.getByRole('alert').textContent).toContain('请先完成人机验证后再提交');
    expect(register.registerReader).not.toHaveBeenCalled();
  });

  it('已验证时提交按钮可用，payload 随注册请求进入请求体', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    render(<RegisterForm />);

    const submit = screen.getByRole('button', { name: '提交注册' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fillValidForm();
    submitForm();

    await waitFor(() => expect(register.registerReader).toHaveBeenCalledTimes(1));
    expect(register.registerReader).toHaveBeenCalledWith({
      email: 'hb@example.com',
      name: 'HB',
      password: 'password123',
      passwordConfirm: 'password123',
      altcha: 'cGF5bG9hZA==',
    });
  });

  it('未拿到 payload 时不发送 altcha 字段（保持既有调用形状）', async () => {
    altcha.status = 'pending';
    render(<RegisterForm />);

    fillValidForm();
    submitForm();

    await waitFor(() => expect(register.registerReader).toHaveBeenCalledTimes(1));
    expect(register.registerReader).toHaveBeenCalledWith({
      email: 'hb@example.com',
      name: 'HB',
      password: 'password123',
      passwordConfirm: 'password123',
    });
  });

  it('服务端返回 CAPTCHA_INVALID：提示中文文案并重置 widget', async () => {
    altcha.status = 'verified';
    altcha.payload = 'c3RhbGUtcGF5bG9hZA==';
    register.registerReader.mockResolvedValueOnce({
      success: false,
      error: { status: 400, response: { code: 'CAPTCHA_INVALID' } },
    });

    render(<RegisterForm />);
    fillValidForm();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('人机验证未通过，请重新验证');
    });
    expect(altcha.reset, '校验失败后必须重新取挑战').toHaveBeenCalled();
    // 失败后按钮状态由 widget 的新状态决定，这里只确认没有误报成功
    expect(screen.queryByText('提交已受理，请验证邮箱')).toBeNull();
  });

  it('服务端返回 CAPTCHA_UNCONFIGURED（503）同样给出可读提示', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    register.registerReader.mockResolvedValueOnce({
      success: false,
      error: { status: 503, response: { code: 'CAPTCHA_UNCONFIGURED' } },
    });

    render(<RegisterForm />);
    fillValidForm();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('人机验证服务暂不可用，请稍后重试');
    });
    expect(altcha.reset).toHaveBeenCalled();
  });

  it('非 CAPTCHA 错误仍走原有兜底文案', async () => {
    altcha.status = 'verified';
    altcha.payload = 'cGF5bG9hZA==';
    register.registerReader.mockResolvedValueOnce({
      success: false,
      error: { status: 400, response: { code: 'EMAIL_RATE_LIMITED' } },
    });

    render(<RegisterForm />);
    fillValidForm();
    submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('注册失败，请检查信息后重试');
    });
    expect(altcha.reset, '非人机验证错误不应重置 widget').not.toHaveBeenCalled();
  });
});
