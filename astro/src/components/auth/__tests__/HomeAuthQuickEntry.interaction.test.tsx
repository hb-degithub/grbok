import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * HomeAuthQuickEntry 交互回归：样式迁移不得破坏登录/注销/角色门禁。
 * 用可变 mock 状态覆盖「未登录 → 登录入口」与「已登录 → 管理后台 + 退出登录」两条真实分支。
 */

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  state: {
    user: null as null | { id: string; email: string; role: 'admin' | 'reader' },
    isAuthenticated: false,
    isLoading: false,
    canAccessAdmin: false,
  },
}));

vi.mock('../../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ ...mocks.state, logout: mocks.logout }),
  getUserDisplayName: () => 'HB',
  getUserInitial: () => 'H',
  ROLE_LABELS: { admin: '管理员', author: '作者', reader: '读者' },
}));

import HomeAuthQuickEntry from '../HomeAuthQuickEntry';

beforeEach(() => {
  mocks.logout.mockClear();
  mocks.state = { user: null, isAuthenticated: false, isLoading: false, canAccessAdmin: false };
});

afterEach(cleanup);

describe('HomeAuthQuickEntry', () => {
  it('未登录时提供 /login 入口', () => {
    render(<HomeAuthQuickEntry />);

    const link = screen.getByRole('link', { name: /登录 \/ 注册/ });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('已登录时保留管理入口与退出登录（真实 logout 调用）', () => {
    mocks.state = {
      user: { id: 'u1', email: 'hb@example.com', role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      canAccessAdmin: true,
    };

    render(<HomeAuthQuickEntry />);

    const admin = screen.getByRole('link', { name: /管理后台/ });
    expect(admin.getAttribute('href')).toBe('/admin');
    expect(screen.getByText('管理员')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /退出登录/ }));
    expect(mocks.logout).toHaveBeenCalledWith('/');
  });

  it('无后台权限时不渲染管理入口', () => {
    mocks.state = {
      user: { id: 'u2', email: 'reader@example.com', role: 'reader' },
      isAuthenticated: true,
      isLoading: false,
      canAccessAdmin: false,
    };

    render(<HomeAuthQuickEntry />);

    expect(screen.queryByRole('link', { name: /管理后台/ })).toBeNull();
    expect(screen.getByRole('button', { name: /退出登录/ })).toBeTruthy();
  });
});
