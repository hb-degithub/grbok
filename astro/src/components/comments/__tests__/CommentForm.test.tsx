import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 评论提交表单行为契约（阅读路径 · 评论体验）。
 *
 * 2026-11 登录门禁改造后的契约：
 *   1. 未登录：不渲染 textarea / 提交按钮，显示「登录后可评论」+ /login，且不会调用 onSubmit；
 *   2. 已登录：不渲染昵称/邮箱输入，只读展示账号身份，payload 用账号信息；
 *   3. 提交结果（提交中/成功）写入一个**常驻** live region；
 *      失败文案只由内联 `role="alert"` 播报一次；
 *   4. 失败文案取**本次提交返回值**里的 error，而不是 await 之前捕获的旧 `serverError` prop；
 *   5. 服务端 401/403（authRequired）→ 提示「请先登录」并给出 /login 入口。
 *
 * 限流器是模块级单例，这里用可控替身，避免用例之间互相消耗令牌。
 */

const limiter = vi.hoisted(() => ({ allow: true }));

vi.mock('../../../lib/security', () => ({
  RateLimiter: class {
    tryConsume() {
      return limiter.allow;
    }
  },
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
  getCurrentUser: vi.fn<() => { id: string; name?: string; email?: string } | null>(() => ({ id: 'u1', name: '读者', email: 'reader@example.com' })),
  onAuthChange: vi.fn(() => () => {}),
  getUserEmail: vi.fn(() => 'reader@example.com' as string | null),
}));

vi.mock('../../../lib/services/authService', () => ({ authService: auth }));

vi.mock('../../../lib/blog-auth-client', () => ({ requestVerification: vi.fn() }));

import CommentForm from '../CommentForm';

const liveRegion = () => screen.getByRole('status');
const liveText = () => liveRegion().textContent ?? '';
const alertText = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

function fillForm({ content = '写点东西' } = {}) {
  fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: content } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '发表评论' }));
}

function loginAsGuest() {
  auth.isAuthenticated.mockReturnValue(false);
  auth.getCurrentUser.mockReturnValue(null);
}

function loginAs(user: { name?: string; email?: string } = { name: '读者', email: 'reader@example.com' }) {
  auth.isAuthenticated.mockReturnValue(true);
  auth.getCurrentUser.mockReturnValue({ id: 'u1', ...user });
}

beforeEach(() => {
  limiter.allow = true;
  loginAs();
  cleanup();
});

afterEach(cleanup);

describe('CommentForm · 登录门禁', () => {
  it('未登录不渲染 textarea，显示「登录后可评论」与 /login 入口', async () => {
    loginAsGuest();
    const onSubmit = vi.fn();
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    expect(await screen.findByText('登录后可评论')).toBeTruthy();
    expect(screen.queryByLabelText('评论内容')).toBeNull();
    expect(screen.queryByRole('button', { name: '发表评论' })).toBeNull();

    const loginLink = screen.getByRole('link', { name: '去登录' });
    expect(loginLink.getAttribute('href')).toBe('/login');
  });

  it('未登录时不触发任何提交', async () => {
    loginAsGuest();
    const onSubmit = vi.fn();
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByText('登录后可评论');
    // 没有任何可提交的表单：点击页面上的链接也不会 call onSubmit
    fireEvent.click(screen.getByRole('link', { name: '去登录' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('已登录隐藏昵称/邮箱输入，只读展示账号身份', async () => {
    render(<CommentForm postId="post-1" onSubmit={vi.fn()} />);

    await screen.findByLabelText('评论内容');
    expect(screen.queryByLabelText('昵称')).toBeNull();
    expect(screen.queryByLabelText('邮箱（可选）')).toBeNull();

    const identity = screen.getByTestId('comment-identity');
    expect(identity.textContent).toContain('读者');
    expect(identity.textContent).toContain('reader@example.com');
    expect(screen.getByText(/以 读者 的身份评论/)).toBeTruthy();
  });
});

describe('CommentForm · 提交 payload', () => {
  it('payload 使用账号昵称/邮箱，而不是用户输入', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      author_name: '读者',
      author_email: 'reader@example.com',
      content: '写点东西',
      parent_id: null,
    });
  });

  it('账号没有昵称时用邮箱前缀兜底', async () => {
    loginAs({ name: '', email: 'noname@example.com' });
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      author_name: 'noname',
      author_email: 'noname@example.com',
    });
  });
});

describe('CommentForm · live region', () => {
  it('把提交结果写入常驻 polite live region（审核开启）', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} moderationEnabled />);

    await screen.findByLabelText('评论内容');
    expect(liveRegion().getAttribute('aria-live')).toBe('polite');
    expect(liveRegion().getAttribute('aria-atomic')).toBe('true');

    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('评论提交成功，审核后展示'));
  });

  it('提交期间播报“正在提交评论…”', async () => {
    let resolveSubmit!: (value: boolean) => void;
    const onSubmit = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveSubmit = resolve; })
    );
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('正在提交评论…'));
    await act(async () => { resolveSubmit(true); });
    await waitFor(() => expect(liveText()).toContain('评论提交成功'));
  });

  it('审核关闭时不播报审核文案', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} moderationEnabled={false} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('评论提交成功'));
    expect(liveText()).not.toContain('审核后展示');
  });

  it('提交失败时只由内联 alert 播报服务端文案，不在 polite 区域重复', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '请先验证你的邮箱后再发表评论' });
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('请先验证你的邮箱后再发表评论'));
    // 同一文案只念一次：常驻 live region 不重复错误
    expect(liveText()).not.toContain('请先验证你的邮箱后再发表评论');
    expect(liveText()).not.toContain('提交失败');
    expect(screen.getByRole('button', { name: '发表评论' })).toBeTruthy();
  });

  it('失败文案取本次返回的 error，而不是 await 前捕获的旧 serverError prop', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '本次失败：邮箱未验证' });
    render(<CommentForm postId="post-1" onSubmit={onSubmit} serverError="上一次的旧错误" />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('本次失败：邮箱未验证'));
    expect(alertText()).not.toContain('上一次的旧错误');
  });

  it('旧式 boolean 失败回调（无 error 结果）回退到通用失败兜底', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('提交失败，请重试'));
    expect(liveText()).not.toContain('提交失败，请重试');
  });

  it('服务端要求登录（authRequired）时提示「请先登录」并给出 /login 入口', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      success: false,
      error: 'Only registered users can post comments.',
      authRequired: true,
    });
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('请先登录后再发表评论'));
    const link = screen.getByRole('link', { name: '去登录' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});

describe('CommentForm · 校验反馈', () => {
  it('空内容：不提交，字段与内联 alert 同步报错', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    submit();

    await waitFor(() => expect(alertText()).toContain('请填写评论内容'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('评论内容').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('评论内容').getAttribute('aria-describedby')).toBe('comment-form-error');
    // 错误不再由 polite live region 重复播报
    expect(liveText()).not.toContain('请填写评论内容');
  });

  it('输入修正后清除字段错误，允许再次提交', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    submit();
    await waitFor(() => expect(alertText()).toContain('请填写评论内容'));

    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '补上内容' } });
    expect(screen.getByLabelText('评论内容').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('超出长度限制时报长度文案且不提交', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: 'a'.repeat(1001) } });
    submit();

    await waitFor(() => expect(alertText()).toContain('评论不超过 1000 字'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('限流时报频率提示且不提交', async () => {
    limiter.allow = false;
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    await screen.findByLabelText('评论内容');
    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('操作太频繁，请稍后再试'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('展示字数统计', async () => {
    render(<CommentForm postId="post-1" onSubmit={vi.fn()} />);

    await screen.findByLabelText('评论内容');
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '四个汉字' } });
    expect(screen.getByText('4 / 1000')).toBeTruthy();
  });
});
