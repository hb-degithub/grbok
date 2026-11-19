import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/ui/Toast', () => ({ showToast: vi.fn() }));

import { showToast } from '../../../components/ui/Toast';
import { adminPostService, type Post } from '../../../lib/services/adminPostService';
import { useAdminPosts } from '../useAdminPosts';

/**
 * Task A 行为契约：文章列表加载失败必须让用户看见，
 * 并且不能把「请求失败」伪装成「没有文章」。
 *
 * 现状问题：catch 里只 console.error，列表保持空数组且没有提示，
 * 用户看到的是空列表 / 空分页，误以为真的没有数据。
 */

const mockedShowToast = vi.mocked(showToast);

const post = (id: string): Post => ({
  id,
  title: `标题 ${id}`,
  slug: `post-${id}`,
  status: 'published',
  created: '2026-01-01 00:00:00.000Z',
  updated: '2026-01-01 00:00:00.000Z',
});

const listResult = (items: Post[], totalPages = 1) =>
  ({ items, page: 1, perPage: 20, totalItems: items.length, totalPages }) as never;

const forbiddenError = {
  status: 403,
  message: 'Forbidden',
  response: { data: { message: '没有执行该操作的权限' } },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useAdminPosts · 加载失败不伪装空态', () => {
  it('请求失败时给出可见错误（toast + error 状态），而不是静默失败', async () => {
    vi.spyOn(adminPostService, 'getPosts').mockRejectedValue(forbiddenError);

    const { result } = renderHook(() => useAdminPosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('没有执行该操作的权限');
    expect(result.current.posts).toEqual([]);
    expect(mockedShowToast).toHaveBeenCalledWith('没有执行该操作的权限', 'error');
  });

  it('刷新失败时保留上一次成功的数据与分页，不清空成空列表', async () => {
    const getSpy = vi
      .spyOn(adminPostService, 'getPosts')
      .mockResolvedValue(listResult([post('1'), post('2')], 3));

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts).toHaveLength(2));
    expect(result.current.totalPages).toBe(3);

    getSpy.mockRejectedValue(new Error('网络异常'));
    await act(async () => {
      await result.current.fetchPosts();
    });

    expect(result.current.posts).toHaveLength(2);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(mockedShowToast).toHaveBeenCalledWith(expect.stringContaining('网络异常'), 'error');
  });

  it('后续请求成功后清除错误', async () => {
    const getSpy = vi
      .spyOn(adminPostService, 'getPosts')
      .mockRejectedValueOnce(forbiddenError)
      .mockResolvedValueOnce(listResult([post('1')], 1));

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.error).toBe('没有执行该操作的权限'));

    await act(async () => {
      await result.current.fetchPosts();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.posts).toHaveLength(1);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
