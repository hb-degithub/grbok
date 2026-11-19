import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * Task C：账号页未登录引导。
 *
 * 契约：
 * - 会话确认中（isLoading）只显示中性的“正在确认登录状态”，不提前闪“请先登录”；
 * - 确认未登录后显示登录引导与 /login 入口，而不是空白；
 * - 已登录时原设置表单继续渲染。
 */
const auth = vi.hoisted(() => ({
  state: {
    user: null as null | { id: string; email: string; name?: string; role: 'reader' | 'admin' },
    isLoading: true,
  },
}));

vi.mock('../../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({
    user: auth.state.user,
    isLoading: auth.state.isLoading,
    isAuthenticated: !!auth.state.user,
    canAccessAdmin: false,
    logout: vi.fn(),
  }),
  getUserDisplayName: (user: { name?: string; email?: string } | null) =>
    user?.name?.trim() || user?.email || '已登录用户',
}));

vi.mock('../../../lib/services/userService', () => ({
  userService: {
    getNotificationPreferences: () => ({ notify_comment_reply: true, notify_post_comment: true }),
    updateNotificationPreferences: vi.fn(async () => ({ success: true })),
    isLoggedIn: () => !!auth.state.user,
  },
}));

vi.mock('../../../lib/blog-auth-client', () => ({
  requestEmailChange: vi.fn(async () => ({ accepted: true, referenceId: 'ref-1' })),
  isAccountMailRateLimited: vi.fn(() => false),
}));

import NotificationSettings from '../NotificationSettings';
import EmailChangeForm from '../EmailChangeForm';

beforeEach(() => {
  auth.state = { user: null, isLoading: true };
});

afterEach(cleanup);

const reader = { id: 'u1', email: 'reader@example.com', name: 'Reader', role: 'reader' as const };

describe('通知设置页未登录引导', () => {
  it('会话确认中显示中性状态，不闪“请先登录”', () => {
    auth.state = { user: null, isLoading: true };
    render(<NotificationSettings />);

    expect(screen.getByRole('status').textContent).toContain('正在确认登录状态');
    expect(screen.queryByText('请先登录')).toBeNull();
    expect(screen.queryByRole('link', { name: '前往登录' })).toBeNull();
  });

  it('确认未登录后显示登录引导而非空白', () => {
    auth.state = { user: null, isLoading: false };
    const { container } = render(<NotificationSettings />);

    expect(container.textContent?.trim().length).toBeGreaterThan(0);
    expect(screen.getByText('请先登录')).toBeTruthy();
    const login = screen.getByRole('link', { name: '前往登录' });
    expect(login.getAttribute('href')).toBe('/login');
  });

  it('已登录时仍渲染通知偏好表单', () => {
    auth.state = { user: reader, isLoading: false };
    render(<NotificationSettings />);

    expect(screen.queryByText('请先登录')).toBeNull();
    expect(screen.getByText('邮件通知设置')).toBeTruthy();
    expect(screen.getByLabelText('有人回复我的评论时通知我')).toBeTruthy();
  });
});

describe('邮箱变更页未登录引导', () => {
  it('会话确认中不提前闪“请先登录”', () => {
    auth.state = { user: null, isLoading: true };
    render(<EmailChangeForm />);

    expect(screen.getByRole('status').textContent).toContain('正在确认登录状态');
    expect(screen.queryByText('请先登录')).toBeNull();
  });

  it('确认未登录后显示登录引导与 /login 入口', () => {
    auth.state = { user: null, isLoading: false };
    render(<EmailChangeForm />);

    expect(screen.getByText('请先登录')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往登录' }).getAttribute('href')).toBe('/login');
  });
});
