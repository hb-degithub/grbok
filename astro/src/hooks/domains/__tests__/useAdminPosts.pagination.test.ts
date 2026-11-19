import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/ui/Toast', () => ({ showToast: vi.fn() }));

import { showToast } from '../../../components/ui/Toast';
import { adminPostService, type Post } from '../../../lib/services/adminPostService';
import { useAdminPosts } from '../useAdminPosts';

/**
 * Task B 行为契约：文章列表必须是真分页、旧请求不得覆盖新结果、
 * 筛选切换失败时不得用上一筛选的数据冒充新筛选结果。
 *
 * 现状问题：
 * - 初始 effect 依赖 fetchPosts，而 fetchPosts 依赖 page；任何 page 变化都会
 *   再次触发 effect → setPage(1)，下一页永远回到第 1 页；
 * - 请求没有版本号，慢的旧请求晚到时会覆盖新请求的结果；
 * - 失败时保留旧数据在「刷新同一视图」场景是对的，但筛选/搜索已切换时
 *   旧视图的数据会被当成新视图结果展示。
 */

const mockedShowToast = vi.mocked(showToast);

const post = (id: string, status: Post['status'] = 'published'): Post => ({
  id,
  title: `标题 ${id}`,
  slug: `post-${id}`,
  status,
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

const stepUpError = {
  status: 403,
  message: 'Forbidden',
  response: { data: { code: 'ADMIN_STEP_UP_REQUIRED' } },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useAdminPosts · 真分页', () => {
  it('翻到下一页会请求第 2 页并停留在第 2 页，不会被 effect 拉回第 1 页', async () => {
    const getSpy = vi
      .spyOn(adminPostService, 'getPosts')
      .mockImplementation(async (targetPage = 1) => listResult([post(`p${targetPage}`)], 3));

    const { result } = renderHook(() => useAdminPosts());

    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p1'));
    expect(result.current.page).toBe(1);
    expect(getSpy).toHaveBeenLastCalledWith(1, 20, expect.any(Object));

    await act(async () => {
      result.current.setPage(2);
    });

    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p2'));
    expect(result.current.page).toBe(2);
    expect(getSpy).toHaveBeenLastCalledWith(2, 20, expect.any(Object));

    // 再等一拍，确认 page 没有被副作用重置回 1
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.page).toBe(2);
    expect(result.current.posts[0]?.id).toBe('p2');
    expect(getSpy).not.toHaveBeenLastCalledWith(1, 20, expect.any(Object));
  });

  it('切换筛选会重置到第 1 页，并带上新筛选请求', async () => {
    const getSpy = vi
      .spyOn(adminPostService, 'getPosts')
      .mockImplementation(async (targetPage = 1, _perPage?: number, filter?: { status?: string }) =>
        listResult([post(`${filter?.status ?? 'all'}-${targetPage}`)], 3),
      );

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('all-1'));

    await act(async () => {
      result.current.setPage(3);
    });
    await waitFor(() => expect(result.current.page).toBe(3));

    await act(async () => {
      result.current.setFilter('draft');
    });

    await waitFor(() => expect(result.current.page).toBe(1));
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('draft-1'));
    expect(getSpy).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ status: 'draft' }));
  });

  it('慢的旧请求晚到不会覆盖新请求的结果', async () => {
    let resolveFirst: (value: never) => void = () => {};
    const getSpy = vi.spyOn(adminPostService, 'getPosts');

    getSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve as (value: never) => void;
        }),
    );
    getSpy.mockResolvedValueOnce(listResult([post('new')], 2));

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      result.current.setPage(2);
    });
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('new'));

    // 第 1 页的旧请求此刻才返回：必须被丢弃
    await act(async () => {
      resolveFirst(listResult([post('old')], 2) as never);
      await Promise.resolve();
    });

    expect(result.current.posts.map((item) => item.id)).toEqual(['new']);
    expect(result.current.page).toBe(2);
    expect(result.current.loading).toBe(false);
  });
  it('页码越界（末页最后一条被删）时收敛到真实末页', async () => {
    const getSpy = vi.spyOn(adminPostService, 'getPosts').mockImplementation(async (targetPage = 1) => {
      if (targetPage >= 3) return listResult([], 2);
      return listResult([post(`p${targetPage}`)], 2);
    });

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p1'));

    await act(async () => {
      result.current.setPage(3);
    });

    await waitFor(() => expect(result.current.page).toBe(2));
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p2'));
    expect(getSpy).toHaveBeenLastCalledWith(2, 20, expect.any(Object));
  });
});

describe('useAdminPosts · 失败不冒充新筛选结果', () => {
  it('筛选切换失败时清空上一筛选的数据，而不是继续展示旧结果', async () => {
    vi.spyOn(adminPostService, 'getPosts')
      .mockResolvedValueOnce(listResult([post('all-1')], 1))
      .mockRejectedValueOnce(forbiddenError);

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts).toHaveLength(1));

    await act(async () => {
      result.current.setFilter('draft');
    });

    await waitFor(() => expect(result.current.error).toBe('没有执行该操作的权限'));
    expect(result.current.posts).toEqual([]);
    expect(result.current.totalPages).toBe(1);
  });

  it('翻页失败时保留上一次成功的分页（可回退），不会困在第 2 页且无分页可回', async () => {
    vi.spyOn(adminPostService, 'getPosts').mockImplementation(async (targetPage = 1) => {
      if (targetPage === 2) throw new Error('网络异常');
      return listResult([post(`p${targetPage}`)], 3);
    });

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p1'));
    expect(result.current.totalPages).toBe(3);

    await act(async () => {
      result.current.setPage(2);
    });

    await waitFor(() => expect(result.current.error).toContain('网络异常'));
    // 旧页数据清空，但页码不回退、上一次的分页总量仍保留 → 用户能点「上一页」回去
    expect(result.current.posts).toEqual([]);
    expect(result.current.page).toBe(2);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.loading).toBe(false);
  });

  it('重试请求一开始就清除 error 并进入 loading', async () => {
    const getSpy = vi
      .spyOn(adminPostService, 'getPosts')
      .mockImplementationOnce(async () => listResult([post('p1')], 3))
      .mockRejectedValueOnce(new Error('网络异常'));

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('p1'));

    await act(async () => {
      result.current.setPage(2);
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    let resolveRetry: (value: never) => void = () => {};
    getSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve as (value: never) => void;
        }),
    );

    act(() => {
      void result.current.fetchPosts();
    });

    // 新请求开始：错误立即消失、loading 置真（重试有反馈）
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveRetry(listResult([post('p2')], 3) as never);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.posts[0]?.id).toBe('p2');
    expect(result.current.error).toBeNull();
  });

  it('step-up 过期时仍提示重新验证并广播恢复事件', async () => {
    const listener = vi.fn();
    window.addEventListener('blog:admin-step-up-required', listener);
    vi.spyOn(adminPostService, 'getPosts').mockRejectedValue(stepUpError);

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.error).toBe('管理会话已过期，请重新验证动态口令'));

    expect(mockedShowToast).toHaveBeenCalledWith('管理会话已过期，请重新验证动态口令', 'error');
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('blog:admin-step-up-required', listener);
  });
});

describe('useAdminPosts · 保存防重入', () => {
  it('保存进行中再次调用 savePost 不会重复创建文章', async () => {
    vi.spyOn(adminPostService, 'getPosts').mockResolvedValue(listResult([], 1));
    vi.spyOn(adminPostService, 'getTags').mockResolvedValue({ items: [] } as never);
    vi.spyOn(adminPostService, 'getPostTags').mockResolvedValue({ items: [] } as never);
    vi.spyOn(adminPostService, 'syncPostTags').mockResolvedValue(undefined as never);

    let resolveCreate: (value: never) => void = () => {};
    const createSpy = vi.spyOn(adminPostService, 'createPost').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: never) => void;
        }),
    );

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEditing({
        title: '并发保存',
        slug: 'concurrent-save',
        excerpt: '',
        content: '正文',
        cover: '',
        status: 'draft',
      });
    });

    await act(async () => {
      void result.current.savePost();
      void result.current.savePost();
    });

    expect(createSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ id: 'created-post' } as never);
    });
  });

  it('保存成功时按 savedPostId 条件关闭：期间已打开的新文章不会被顺手关掉', async () => {
    vi.spyOn(adminPostService, 'getPosts').mockResolvedValue(listResult([], 1));
    vi.spyOn(adminPostService, 'getTags').mockResolvedValue({ items: [] } as never);
    vi.spyOn(adminPostService, 'getPostTags').mockResolvedValue({ items: [] } as never);
    vi.spyOn(adminPostService, 'syncPostTags').mockResolvedValue(undefined as never);

    let resolveUpdate: (value: never) => void = () => {};
    vi.spyOn(adminPostService, 'updatePost').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve as (value: never) => void;
        }),
    );

    const { result } = renderHook(() => useAdminPosts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEditing({
        id: 'post-old',
        title: '正在保存的文章',
        slug: 'post-old',
        excerpt: '',
        content: '正文',
        cover: '',
        status: 'draft',
      });
    });

    await act(async () => {
      void result.current.savePost();
    });
    expect(adminPostService.updatePost).toHaveBeenCalledTimes(1);

    // 保存仍在进行时打开另一篇（新的）草稿
    act(() => {
      result.current.setEditing({
        title: '新打开的文章',
        slug: '',
        excerpt: '',
        content: '',
        cover: '',
        status: 'draft',
      });
    });

    await act(async () => {
      resolveUpdate({ id: 'post-old' } as never);
    });

    // 保存完成只关闭「被保存的那篇」；后来打开的新草稿必须原样保留
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.editing?.title).toBe('新打开的文章');
  });
});
