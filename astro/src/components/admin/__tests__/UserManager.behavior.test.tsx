import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Task A 行为契约：
 * 1) 错误 banner 不再被「空列表 / 搜索无匹配」早返回吞掉；
 * 2) 用 hook 已有的 page / totalItems / loadUsers 补分页 UI。
 */

type TestUser = {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: 'reader' | 'author' | 'admin' | 'super_admin';
  verified: boolean;
  created: string;
  updated: string;
};

const mocks = vi.hoisted(() => ({
  state: {
    users: [] as TestUser[],
    loading: false,
    error: null as string | null,
    updatingId: null as string | null,
    deletingId: null as string | null,
    page: 1,
    totalItems: 0,
    loadUsers: vi.fn(),
    updateRole: vi.fn(),
    deleteUser: vi.fn(),
    getAvatarUrl: (_user: TestUser) => '',
    setError: vi.fn(),
  },
  authUser: { id: 'me', email: 'me@example.com', role: 'super_admin' as const },
}));

vi.mock('../../../hooks/domains/useAdminUsers', () => ({
  USERS_PER_PAGE: 20,
  useAdminUsers: () => mocks.state,
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    user: mocks.authUser,
    isAuthenticated: true,
    isLoading: false,
    hasPermission: () => true,
  }),
}));

import UserManager from '../UserManager';

const makeUser = (id: string, overrides: Partial<TestUser> = {}): TestUser => ({
  id,
  email: `${id}@example.com`,
  name: `用户${id}`,
  role: 'reader',
  verified: true,
  created: '2026-01-01 00:00:00.000Z',
  updated: '2026-01-01 00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mocks.state.users = [];
  mocks.state.loading = false;
  mocks.state.error = null;
  mocks.state.updatingId = null;
  mocks.state.deletingId = null;
  mocks.state.page = 1;
  mocks.state.totalItems = 0;
  mocks.state.loadUsers.mockReset();
  mocks.state.updateRole.mockReset();
  mocks.state.deleteUser.mockReset();
  mocks.state.setError.mockReset();
});

afterEach(cleanup);

describe('UserManager · 错误可见性', () => {
  it('加载失败且没有数据时错误 banner 仍然可见，不显示成空列表', () => {
    mocks.state.error = '加载失败：权限不足';

    render(<UserManager />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('加载失败：权限不足');
    expect(screen.queryByText('没有找到用户。')).toBeNull();
    expect(screen.queryByText('EMPTY / 0')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(mocks.state.loadUsers).toHaveBeenCalledWith(1);
  });

  it('没有错误时保留原有空态', () => {
    render(<UserManager />);

    expect(screen.getByText('没有找到用户。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('有数据但搜索无匹配时，错误 banner 仍然可见', () => {
    mocks.state.users = [makeUser('u1')];
    mocks.state.error = '更新角色失败：网络异常';

    render(<UserManager />);
    fireEvent.change(screen.getByPlaceholderText('搜索姓名或邮箱'), {
      target: { value: 'nobody' },
    });

    expect(screen.getByRole('alert').textContent).toContain('更新角色失败');
    expect(screen.getByText('没有匹配的用户。')).toBeTruthy();
  });
});

describe('UserManager · 分页', () => {
  it('用已有 page/totalItems/loadUsers 渲染分页，下一页请求第 2 页', () => {
    mocks.state.users = [makeUser('u1')];
    mocks.state.totalItems = 45;

    render(<UserManager />);

    expect(screen.getByText('第 1 / 3 页')).toBeTruthy();

    const prev = screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(mocks.state.loadUsers).toHaveBeenCalledWith(2);
  });

  it('只有一页时不渲染分页控件', () => {
    mocks.state.users = [makeUser('u1')];
    mocks.state.totalItems = 3;

    render(<UserManager />);

    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
    expect(screen.queryByText(/第 1 \/ 1 页/)).toBeNull();
  });
});
