import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

/**
 * useComments 的提交结果与错误生命周期（阅读路径 · 评论体验）。
 *
 * 1. 失败时把**本次**服务端文案随结果返回（{success,error}），组件无需等
 *    下一次渲染读取 submitError prop；
 * 2. 每次尝试开始时先清掉上一次的 submitError，避免旧文案污染本次结果。
 */

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

vi.mock('../../lib/services/commentService', () => ({ commentService: service }));

import { useComments } from '../useComments';

const formData = {
  author_name: '读者',
  author_email: '',
  content: '一条评论',
  parent_id: null,
};

beforeEach(() => {
  service.getPublicComments.mockResolvedValue({ items: [], totalItems: 0, totalPages: 1 });
  service.subscribeToPublicComments.mockResolvedValue(() => {});
  service.buildCommentTree.mockImplementation((items: unknown[]) => items);
  service.submitComment.mockReset();
  cleanup();
});

afterEach(cleanup);

describe('useComments · submitComment', () => {
  it('失败时把本次服务端文案随结果返回，并同步暴露 submitError', async () => {
    service.submitComment.mockRejectedValueOnce({
      response: { message: '请先验证你的邮箱后再发表评论' },
    });

    const { result } = renderHook(() => useComments('post-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.submitComment(formData);
    });

    expect(returned).toEqual({ success: false, error: '请先验证你的邮箱后再发表评论', authRequired: false });
    expect(result.current.submitError).toBe('请先验证你的邮箱后再发表评论');
  });

  it('成功时返回 { success: true, error: null }', async () => {
    service.submitComment.mockResolvedValueOnce({ id: 'new-comment' });

    const { result } = renderHook(() => useComments('post-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.submitComment(formData);
    });

    expect(returned).toEqual({ success: true, error: null });
    expect(result.current.submitError).toBeNull();
  });

  it('每次尝试开始时清掉上一次的 submitError', async () => {
    service.submitComment.mockRejectedValueOnce({ message: '旧错误' });

    const { result } = renderHook(() => useComments('post-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submitComment(formData);
    });
    expect(result.current.submitError).toBe('旧错误');

    let resolveSubmit!: (value: unknown) => void;
    service.submitComment.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSubmit = resolve; })
    );

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.submitComment(formData);
    });

    // 新尝试一开始就清空旧错误，不必等结果回来
    await waitFor(() => expect(result.current.submitError).toBeNull());

    await act(async () => {
      resolveSubmit({ id: 'new-comment' });
      await pending;
    });

    expect(result.current.submitError).toBeNull();
    expect(await pending).toEqual({ success: true, error: null });
  });
});
