import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 真实 useComments + CommentForm 的提交链路（阅读路径 · 评论体验）。
 *
 * 回归目标：首次 submitComment 失败时，表单必须立刻显示服务端文案。
 * 旧实现读取 await 之前捕获的 `serverError` prop（此时仍是 null），
 * 因此第一次失败永远只显示通用兜底；这里用**真实 hook**（只 mock 网络层
 * commentService）证明错误直接从本次提交结果回到组件。
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

const service = vi.hoisted(() => ({
  getPublicComments: vi.fn(),
  buildCommentTree: vi.fn((items: unknown[]) => items),
  subscribeToPublicComments: vi.fn(async () => () => {}),
  submitComment: vi.fn(),
  extractSubmitMessage: vi.fn(
    (err: { response?: { message?: string }; message?: string } | null | undefined) =>
      err?.response?.message ?? err?.message ?? '提交失败，请重试'
  ),
}));

vi.mock('../../../lib/services/commentService', () => ({ commentService: service }));

import CommentForm from '../CommentForm';
import { useComments } from '../../../hooks/useComments';

function Harness() {
  const { submitComment, submitError } = useComments('post-1', { enabled: true });
  return <CommentForm postId="post-1" onSubmit={submitComment} serverError={submitError} />;
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '读者' } });
  fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '第一条评论' } });
  fireEvent.click(screen.getByRole('button', { name: '发表评论' }));
}

beforeEach(() => {
  limiter.allow = true;
  service.getPublicComments.mockResolvedValue({ items: [], totalItems: 0, totalPages: 1 });
  service.subscribeToPublicComments.mockResolvedValue(() => {});
  service.buildCommentTree.mockImplementation((items: unknown[]) => items);
  service.submitComment.mockReset();
  cleanup();
});

afterEach(cleanup);

describe('CommentForm ← useComments · 首次失败反馈', () => {
  it('首次提交失败立即显示服务端文案（不依赖重渲染后的 serverError prop）', async () => {
    service.submitComment.mockRejectedValueOnce({
      response: { message: '请先验证你的邮箱后再发表评论' },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByLabelText('评论内容')).toBeTruthy());

    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('请先验证你的邮箱后再发表评论')
    );
    // 同一错误只由内联 alert 播报一次
    expect(screen.getByRole('status').textContent ?? '').not.toContain('请先验证你的邮箱后再发表评论');
  });

  it('上一次失败的旧错误不会出现在下一次失败的提示里', async () => {
    service.submitComment
      .mockRejectedValueOnce({ response: { message: '旧的服务端错误' } })
      .mockRejectedValueOnce({ response: { message: '新的服务端错误' } });

    render(<Harness />);
    await waitFor(() => expect(screen.getByLabelText('评论内容')).toBeTruthy());

    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('旧的服务端错误'));

    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('新的服务端错误'));
    expect(screen.getByRole('alert').textContent).not.toContain('旧的服务端错误');
  });
});
