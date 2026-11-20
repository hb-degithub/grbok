import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 密码登录的真实角色跳转契约。
 *
 * 历史缺陷：`handlePostLogin` 拿到了 `auth.record.role`，但成功后的
 * `useEffect` 固定调用 `getPostLoginRedirect(undefined)`，于是 author 也被送到 `/`
 * （后台账号登录后落回前台）。这里锁定三件事：
 * 1. author 密码登录成功 -> `/admin`；
 * 2. reader 登录成功 -> `/`（行为不变）；
 * 3. admin/super_admin 仍先走 TOTP 二次验证，绝不由密码表单直接跳 `/admin`。
 */

const auth = vi.hoisted(() => ({
  authWithPassword: vi.fn(),
}));

vi.mock('../../../lib/services/authService', () => ({
  authService: {
    getPocketBase: () => ({
      collection: () => ({ authWithPassword: auth.authWithPassword }),
    }),
  },
}));

// 真实实现会先向后台撤销旧管理员凭据；这里只验证登录成功后的角色分支。
vi.mock('../../../lib/admin-auth-lifecycle', () => ({
  runAfterAdminCredentialRevoked: async (
    _pb: unknown,
    _clear: () => void,
    operation: () => Promise<unknown>,
  ) => operation(),
}));

vi.mock('../../../lib/admin-step-up', () => ({
  clearAdminStepUp: vi.fn(),
}));

// TOTP 门禁有独立测试；这里只确认控制权交给它，并且表单自己不做跳转。
vi.mock('../TotpStepGate', () => ({
  default: () => <div data-testid="totp-step-gate">TOTP 二次验证</div>,
}));

import PasswordLoginForm from '../PasswordLoginForm';

const originalLocation = window.location;

function stubLocation(startHref: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: startHref },
  });
}

function fillAndSubmit(email = 'hb@example.com', password = 'secret') {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
}

async function loginAs(role: string) {
  auth.authWithPassword.mockResolvedValue({ token: 'token', record: { id: 'u1', email: 'hb@example.com', role } });
  render(<PasswordLoginForm />);
  fillAndSubmit();
  await screen.findByText('登录成功');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.authWithPassword.mockReset();
  stubLocation('/login');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
});

describe('PasswordLoginForm · 密码登录后的角色跳转', () => {
  it('author 登录成功后跳转到 /admin，而不是留在前台', async () => {
    await loginAs('author');

    // 成功分支有 500ms 缓冲定时器；放宽等待上限，避免并行跑全量测试时抖动。
    await waitFor(() => expect(window.location.href).toBe('/admin'), { timeout: 3000 });
  });

  it('reader 登录成功后仍然回到首页 /', async () => {
    await loginAs('reader');

    await waitFor(() => expect(window.location.href).toBe('/'), { timeout: 3000 });
  });

  it('TOTP 强制角色（admin）交给二次验证，不在密码表单里直接跳 /admin', async () => {
    auth.authWithPassword.mockResolvedValue({ token: 'token', record: { id: 'u1', email: 'hb@example.com', role: 'admin' } });
    render(<PasswordLoginForm />);
    fillAndSubmit();

    expect(await screen.findByTestId('totp-step-gate')).toBeTruthy();
    expect(screen.queryByText('登录成功')).toBeNull();

    // 等过成功分支的 500ms 定时器窗口，确认没有任何自动跳转发生。
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(window.location.href).toBe('/login');
  });

  it('缺少 MFA 支持时显示可读中文，同时保留机器可读错误码', async () => {
    auth.authWithPassword.mockRejectedValue({
      status: 400,
      response: { mfaId: 'mfa_1', message: 'MFA required' },
    });
    render(<PasswordLoginForm />);
    fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('多因素验证');
    expect(alert.textContent).not.toContain('MFA_UNSUPPORTED');

    const form = screen.getByRole('button', { name: '登录' }).closest('form');
    expect(form?.getAttribute('data-error-code')).toBe('MFA_UNSUPPORTED');
    expect(window.location.href).toBe('/login');
  });
});
