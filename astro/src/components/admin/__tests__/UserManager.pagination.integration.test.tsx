import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Task A 审查修复的回归测试：
 * 1) 删除末页最后一个用户后 page 越界，必须 clamp 到实际最后一页，不能停在空白页；
 * 2) 加载失败时不显示「共 0 个用户」的伪计数；重试保留当前 page。
 *
 * 这里刻意使用**真实的 useAdminUsers**（只 mock 底层 adminUserService），
 * 以覆盖 hook 的 clamp/保留状态逻辑，而不是只 mock hook 的返回值。
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

const service = vi.hoisted(() => ({
  getUsers: vi.fn(),
  updateUserRole: vi.fn(),
  deleteUser: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock('../../../lib/services/adminUserService', () => ({
  adminUserService: service,
}));

// useAdminUsers 只为头像拼 URL，测试里不需要真实 PB 客户端。
vi.mock('../../../lib/pocketbase', () => ({
  buildFileUrl: (collection: string, id: string, file: string) => `/${collection}/${id}/${file}`,
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    user: { id: 'me', email: 'me@example.com', role: 'super_admin' },
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

/** 模拟 PocketBase：删除后 totalItems 缩小，越界页返回空 items。 */
function setRoster(count: number) {
  const state = {
    users: Array.from({ length: count }, (_, i) => makeUser(`u${i + 1}`)),
    totalItems: count,
  };

  service.getUsers.mockImplementation(async (page: number, perPage = 20) => ({
    items: state.users.slice((page - 1) * perPage, page * perPage),
    totalItems: state.totalItems,
  }));

  service.deleteUser.mockImplementation(async (id: string) => {
    const index = state.users.findIndex((user) => user.id === id);
    if (index >= 0) state.users.splice(index, 1);
    state.totalItems = state.users.length;
  });

  return state;
}

beforeEach(() => {
  service.getUsers.mockReset();
  service.updateUserRole.mockReset();
  service.deleteUser.mockReset();
});

afterEach(cleanup);

describe('UserManager · 真实 useAdminUsers 分页收敛', () => {
  it('删除末页最后一个用户后 clamp 到实际最后一页，不会停在空白页', async () => {
    setRoster(41);

    render(<UserManager />);

    await waitFor(() => expect(screen.getByText('第 1 / 3 页')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('第 2 / 3 页')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('第 3 / 3 页')).toBeTruthy());
    expect(screen.getByText('用户u41')).toBeTruthy();

    // 删除第 3 页唯一的用户 → 第 3 页越界
    fireEvent.click(screen.getByRole('button', { name: '删除用户' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));

    await waitFor(() => expect(service.deleteUser).toHaveBeenCalledWith('u41'));
    await waitFor(() => expect(screen.getByText('第 2 / 2 页')).toBeTruthy());

    // 最终停在真实最后一页（第 2 页）且确实有数据，而不是空白的第 3 页
    expect(service.getUsers).toHaveBeenLastCalledWith(2, 20);
    expect(screen.getByText('用户u21')).toBeTruthy();
    expect(screen.queryByText('没有找到用户。')).toBeNull();
  });

  it('首次加载失败时不显示「共 0 个用户」伪计数，而是明确错误', async () => {
    service.getUsers.mockRejectedValue(new Error('加载失败：权限不足'));

    render(<UserManager />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('加载失败：权限不足'));

    expect(screen.queryByText(/共 0 个用户/)).toBeNull();
    expect(screen.getByText('用户数不可用')).toBeTruthy();
    expect(screen.queryByText('没有找到用户。')).toBeNull();
  });

  it('第 2 页操作失败后重试仍请求当前页，不跳回第 1 页', async () => {
    setRoster(41);
    service.deleteUser.mockRejectedValueOnce(new Error('服务端拒绝：至少需要保留一个超级管理员'));

    render(<UserManager />);
    await waitFor(() => expect(screen.getByText('第 1 / 3 页')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('第 2 / 3 页')).toBeTruthy());

    // 第 2 页第一行删除失败，错误由服务端中文信息透出
    fireEvent.click(screen.getAllByRole('button', { name: '删除用户' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('服务端拒绝'));

    const callsBeforeRetry = service.getUsers.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(service.getUsers.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
    expect(service.getUsers).toHaveBeenLastCalledWith(2, 20);
  });
});
