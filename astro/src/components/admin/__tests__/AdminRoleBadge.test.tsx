import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * 顶栏角色徽标：显示的是 useAdminAuth().user 的真实角色，
 * 不是 AdminLayout 的 requiredRole（页面门槛）。渲染层只读，不做鉴权。
 */

type TestRole = 'reader' | 'author' | 'admin' | 'super_admin';

const mocks = vi.hoisted(() => ({
  state: {
    user: null as { id?: string; email?: string; name?: string; role?: string } | null,
    role: null as string | null,
    isLoading: false,
  },
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    isAuthenticated: !!mocks.state.user,
    isLoading: mocks.state.isLoading,
    user: mocks.state.user,
    role: mocks.state.role,
    hasPermission: () => true,
  }),
  useAdminLogout: () => ({ logout: vi.fn() }),
}));

import AdminRoleBadge from '../AdminRoleBadge';

afterEach(() => {
  cleanup();
  mocks.state.user = null;
  mocks.state.role = null;
  mocks.state.isLoading = false;
});

describe('AdminRoleBadge · 真实账号角色', () => {
  it.each<[TestRole, string]>([
    ['reader', '普通用户'],
    ['author', '作者'],
    ['admin', '管理员'],
    ['super_admin', '超级管理员'],
  ])('账号角色 %s 显示为「%s」', (role, label) => {
    mocks.state.user = { email: 'hb@example.com', name: 'HB', role };
    mocks.state.role = role;

    render(<AdminRoleBadge />);

    const badge = screen.getByText('当前角色').closest('[data-role-state="ready"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-role')).toBe(role);
    expect(badge?.textContent).toContain('当前角色');
    expect(badge?.textContent).toContain(label);
  });

  it('不同角色渲染出不同徽标，不会被页面门槛覆盖', () => {
    mocks.state.role = 'admin';
    mocks.state.user = { email: 'admin@example.com', role: 'admin' };
    render(<AdminRoleBadge />);
    expect(screen.getByText('管理员')).toBeTruthy();
    expect(screen.queryByText('超级管理员')).toBeNull();
  });

  it('未登录/无用户时显示「未识别角色」，不猜测角色', () => {
    render(<AdminRoleBadge />);

    const pending = screen.getByText('未识别角色');
    expect(pending.getAttribute('data-role-state')).toBe('unknown');
    for (const label of ['普通用户', '作者', '管理员', '超级管理员']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('用户角色无法识别时同样显示「未识别角色」', () => {
    mocks.state.user = { email: 'broken@example.com', role: 'mystery' };
    mocks.state.role = null;

    render(<AdminRoleBadge />);

    expect(screen.getByText('未识别角色').getAttribute('data-role-state')).toBe('unknown');
  });

  it('加载中提示「角色同步中」，不乱猜角色', () => {
    mocks.state.isLoading = true;

    render(<AdminRoleBadge />);

    const loading = screen.getByText('角色同步中');
    expect(loading.getAttribute('data-role-state')).toBe('loading');
    expect(loading.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByText('当前角色')).toBeNull();
  });

  it('浏览器标题带出当前账号与角色（登录事实，非权限判断）', () => {
    mocks.state.user = { email: 'hb@example.com', name: 'HB', role: 'super_admin' };
    mocks.state.role = 'super_admin';

    render(<AdminRoleBadge />);

    const badge = screen.getByText('当前角色').closest('[data-role-state="ready"]');
    expect(badge?.getAttribute('title')).toContain('hb@example.com');
    expect(badge?.getAttribute('title')).toContain('超级管理员');
  });
});
