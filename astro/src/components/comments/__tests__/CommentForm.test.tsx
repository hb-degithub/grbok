import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 评论提交表单行为契约（阅读路径 · 评论体验）。
 *
 * 关注用户可见结果，而不是实现细节：
 *   1. 提交结果（提交中/成功）写入一个**常驻**的 live region；
 *      失败文案只由内联 `role="alert"` 播报一次，不在 polite 区域重复，
 *      否则屏幕阅读器会把同一条错误念两遍；
 *   2. 失败文案取**本次提交返回值**里的 error，而不是 await 之前捕获的旧
 *      `serverError` prop（旧 prop 在首次失败时永远是 null）；
 *   3. 字段级错误反映在控件 aria-invalid / aria-describedby 上；昵称/邮箱
 *      Input 使用稳定且不冲突的 id（同一页面还有多个回复框）。
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
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn(() => null),
  onAuthChange: vi.fn(() => () => {}),
  getUserEmail: vi.fn(() => null as string | null),
}));

vi.mock('../../../lib/services/authService', () => ({ authService: auth }));

vi.mock('../../../lib/blog-auth-client', () => ({ requestVerification: vi.fn() }));

import CommentForm from '../CommentForm';

const liveRegion = () => screen.getByRole('status');
const liveText = () => liveRegion().textContent ?? '';
const alertText = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

function fillForm({ name = '读者', email = '', content = '写点东西' } = {}) {
  fireEvent.change(screen.getByLabelText('昵称'), { target: { value: name } });
  if (email) {
    fireEvent.change(screen.getByLabelText('邮箱（可选）'), { target: { value: email } });
  }
  fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: content } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '发表评论' }));
}

beforeEach(() => {
  limiter.allow = true;
  cleanup();
});

afterEach(cleanup);

describe('CommentForm · live region', () => {
  it('把提交结果写入常驻 polite live region（审核开启）', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} moderationEnabled />);

    expect(liveRegion().getAttribute('aria-live')).toBe('polite');
    expect(liveRegion().getAttribute('aria-atomic')).toBe('true');

    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('评论提交成功，审核后展示'));
    expect(onSubmit).toHaveBeenCalledWith({
      author_name: '读者',
      author_email: '',
      content: '写点东西',
      parent_id: null,
    });
  });

  it('提交期间播报“正在提交评论…”', async () => {
    let resolveSubmit!: (value: boolean) => void;
    const onSubmit = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveSubmit = resolve; })
    );
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('正在提交评论…'));
    await act(async () => { resolveSubmit(true); });
    await waitFor(() => expect(liveText()).toContain('评论提交成功'));
  });

  it('审核关闭时不播报审核文案', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} moderationEnabled={false} />);

    fillForm();
    submit();

    await waitFor(() => expect(liveText()).toContain('评论提交成功'));
    expect(liveText()).not.toContain('审核后展示');
  });

  it('提交失败时只由内联 alert 播报服务端文案，不在 polite 区域重复', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: false, error: '请先验证你的邮箱后再发表评论' });
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

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

    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('本次失败：邮箱未验证'));
    expect(alertText()).not.toContain('上一次的旧错误');
  });

  it('旧式 boolean 失败回调（无 error 结果）回退到通用失败兜底', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('提交失败，请重试'));
    expect(liveText()).not.toContain('提交失败，请重试');
  });
});

describe('CommentForm · 校验反馈', () => {
  it('空昵称/空内容：不提交，字段与内联 alert 同步报错', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    submit();

    await waitFor(() => expect(alertText()).toContain('请填写昵称和评论内容'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('昵称').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('评论内容').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('评论内容').getAttribute('aria-describedby')).toBe('comment-form-error');
    // 错误不再由 polite live region 重复播报
    expect(liveText()).not.toContain('请填写昵称和评论内容');
  });

  it('邮箱格式错误：只标记邮箱字段，不提交', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    fillForm({ email: 'not-an-email' });
    submit();

    await waitFor(() => expect(alertText()).toContain('邮箱格式不正确'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('邮箱（可选）').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('昵称').getAttribute('aria-invalid')).not.toBe('true');
    expect(screen.getByLabelText('评论内容').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('输入修正后清除字段错误，允许再次提交', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    submit();
    await waitFor(() => expect(alertText()).toContain('请填写昵称和评论内容'));

    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '补上内容' } });
    expect(screen.getByLabelText('评论内容').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('超出长度限制时报长度文案且不提交', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    fillForm({ name: 'a'.repeat(31) });
    submit();

    await waitFor(() => expect(alertText()).toContain('昵称不超过 30 字'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('限流时报频率提示且不提交', async () => {
    limiter.allow = false;
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<CommentForm postId="post-1" onSubmit={onSubmit} />);

    fillForm();
    submit();

    await waitFor(() => expect(alertText()).toContain('操作太频繁，请稍后再试'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('为昵称/邮箱 Input 提供与回复框不冲突的稳定 id', () => {
    render(<CommentForm postId="post-1" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('昵称').id).toBe('comment-author-name');
    expect(screen.getByLabelText('邮箱（可选）').id).toBe('comment-author-email');
    expect(screen.getByLabelText('评论内容').id).toBe('comment-content');
  });
});
