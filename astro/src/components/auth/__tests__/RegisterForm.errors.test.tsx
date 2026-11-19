import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * Task C：注册表单字段级错误关联。
 *
 * 契约：
 * - 校验顺序与文案不变（缺字段 → 邮箱格式 → 密码长度 → 限流 → 一致性）；
 * - 字段错误显示在对应输入框旁，并通过 aria-invalid / aria-describedby 关联；
 * - 密码至少 8 字符的提示挂在「密码」；两次输入不一致挂在「确认密码」；
 * - 任一字段变化清空错误（沿用改造前的 clearError 行为）。
 */
const mocks = vi.hoisted(() => ({
  registerReader: vi.fn(async () => ({ success: true })),
  tryConsume: vi.fn(() => true),
}));

vi.mock('../../../hooks/usePocketBase', () => ({
  usePocketBase: () => ({ registerReader: mocks.registerReader }),
}));

// 只替换限流器行为，5 次 / 0.2 token/s 的配置仍留在组件源码里。
vi.mock('../../../lib/security', () => ({
  RateLimiter: class {
    tryConsume = mocks.tryConsume;
  },
}));

import RegisterForm from '../RegisterForm';

beforeEach(() => {
  mocks.registerReader.mockClear();
  mocks.tryConsume.mockReturnValue(true);
});

afterEach(cleanup);

function submit() {
  const form = document.querySelector('form');
  expect(form, '注册表单未渲染').toBeTruthy();
  fireEvent.submit(form as HTMLFormElement);
}

function fill(values: Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>) {
  const fields: Array<[keyof typeof values, string]> = [
    ['name', '昵称'],
    ['email', '邮箱'],
    ['password', '密码'],
    ['confirm', '确认密码'],
  ];
  for (const [key, label] of fields) {
    const value = values[key];
    if (value === undefined) continue;
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
  }
}

function fieldError(label: string): string {
  const input = screen.getByLabelText(label, { exact: true }) as HTMLInputElement;
  expect(input.getAttribute('aria-invalid'), `${label} 未标记 aria-invalid`).toBe('true');
  const describedBy = input.getAttribute('aria-describedby');
  expect(describedBy, `${label} 缺少 aria-describedby`).toBeTruthy();
  return document.getElementById(describedBy as string)?.textContent || '';
}

describe('RegisterForm 字段错误就近呈现', () => {
  it('空提交在表单级提示，不误挂到邮箱字段', () => {
    render(<RegisterForm />);
    submit();

    expect(screen.getByRole('alert').textContent).toContain('请填写昵称、邮箱、密码和确认密码');
    const email = screen.getByLabelText('邮箱', { exact: true });
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('密码不足 8 字符时错误关联到密码字段', () => {
    render(<RegisterForm />);
    fill({ name: 'HB', email: 'hb@example.com', password: 'short', confirm: 'short' });
    submit();

    expect(fieldError('密码')).toContain('密码至少需要 8 个字符');
    const confirm = screen.getByLabelText('确认密码', { exact: true });
    expect(confirm.getAttribute('aria-invalid')).toBe('false');
    expect(mocks.registerReader).not.toHaveBeenCalled();
  });

  it('两次密码不一致时错误关联到确认密码字段', () => {
    render(<RegisterForm />);
    fill({ name: 'HB', email: 'hb@example.com', password: 'password123', confirm: 'password124' });
    submit();

    expect(fieldError('确认密码')).toContain('两次输入的密码不一致');
    const password = screen.getByLabelText('密码', { exact: true });
    expect(password.getAttribute('aria-invalid')).toBe('false');
    expect(mocks.registerReader).not.toHaveBeenCalled();

    // 修改任一字段即清空错误，保持原有 clearError 行为
    fireEvent.change(screen.getByLabelText('确认密码', { exact: true }), {
      target: { value: 'password123' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('确认密码', { exact: true }).getAttribute('aria-invalid')).toBe('false');
  });

  it('保持校验顺序：邮箱格式先于密码长度', () => {
    render(<RegisterForm />);
    fill({ name: 'HB', email: 'not-an-email', password: 'short', confirm: 'short' });
    submit();

    expect(fieldError('邮箱')).toContain('邮箱格式不正确');
    expect(screen.getByLabelText('密码', { exact: true }).getAttribute('aria-invalid')).toBe('false');
  });

  it('全部合法时仍调用 registerReader，参数不变', async () => {
    render(<RegisterForm />);
    fill({
      name: '  HB  ',
      email: '  hb@example.com  ',
      password: 'password123',
      confirm: 'password123',
    });
    submit();

    await waitFor(() => {
      expect(mocks.registerReader).toHaveBeenCalledTimes(1);
    });
    expect(mocks.registerReader).toHaveBeenCalledWith({
      email: 'hb@example.com',
      name: 'HB',
      password: 'password123',
      passwordConfirm: 'password123',
    });
  });
});
