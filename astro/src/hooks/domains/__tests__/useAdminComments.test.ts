import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 评论审核分页取数回归测试。
 *
 * 现状缺陷：分页控件只调用 setPage，没有任何取数逻辑，
 * 结果是「页码变了、列表还是第 1 页数据」，第 2 页永远看不到。
 *
 * 锁定以下行为契约：
 *   1) goToPage(2) 必须让 service 收到 page=2，并替换成第 2 页数据；
 *   2) 筛选/关键词变化一律回到第 1 页重新取数；
 *   3) 取数失败给出明确错误、保留上一次成功的数据，重试仍请求失败的那一页；
 *   4) 审核/批量操作后仍按当前页重新取数（原有语义不变）；
 *   5) 末页被删空时按真实总数收敛到最后一页，不停在空白页。
 */

const service = vi.hoisted(() => ({
  getComments: vi.fn(),
  updateStatus: vi.fn(),
  updateContent: vi.fn(),
  batchUpdateStatus: vi.fn(),
  batchDelete: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock('../../../lib/services/adminCommentService', () => ({
  adminCommentService: service,
}));

import type { Comment } from '../../../lib/services/adminCommentService';
import { useAdminComments } from '../useAdminComments';

const PER_PAGE = 20;

function makeComment(id: string, status: Comment['status'] = 'pending'): Comment {
  return {
    id,
    post: 'post-1',
    author_name: `作者 ${id}`,
    author_email: `${id}@example.com`,
    content: `内容 ${id}`,
    status,
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
  };
}

/** 模拟 PocketBase 分页：默认 45 条 → 3 页。 */
function servePages(count = 45) {
  const all = Array.from({ length: count }, (_, i) => makeComment(`c${i + 1}`));
  service.getComments.mockImplementation(
    async (_filter: string, page = 1, perPage = PER_PAGE) => ({
      items: all.slice((page - 1) * perPage, page * perPage),
      totalItems: all.length,
    }),
  );
  return all;
}

const forbidden = {
  status: 403,
  message: 'Forbidden',
  response: { data: { message: '没有执行该操作的权限' } },
};

/** 手工控制响应时序的 Promise（用于复现「请求已发出、响应未返回」的真实窗口）。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type PageResult = { items: Comment[]; totalItems: number };

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useAdminComments · 真正的分页取数', () => {
  it('goToPage(2) 让 service 收到 page=2 并替换成第 2 页数据', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(service.getComments).toHaveBeenLastCalledWith('all', 1, PER_PAGE, '');
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.comments.map((c) => c.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `c${i + 1}`),
    );

    await act(async () => {
      await result.current.goToPage(2);
    });

    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');
    expect(result.current.page).toBe(2);
    expect(result.current.comments.map((c) => c.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `c${i + 21}`),
    );
  });

  it('goToPage 越界时收敛到 [1, totalPages]', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(99);
    });
    expect(service.getComments).toHaveBeenLastCalledWith('all', 3, PER_PAGE, '');

    await act(async () => {
      await result.current.goToPage(0);
    });
    expect(service.getComments).toHaveBeenLastCalledWith('all', 1, PER_PAGE, '');
  });

  it('切筛选/改关键词都回到第 1 页', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(3);
    });
    expect(result.current.page).toBe(3);

    act(() => {
      result.current.setFilter('pending');
    });
    await waitFor(() =>
      expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, PER_PAGE, ''),
    );
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setQuery('huba');
    });
    await waitFor(() =>
      expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, PER_PAGE, 'huba'),
    );
    expect(result.current.page).toBe(1);
  });

  it('refresh 按当前页重新取数', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(2);
    });
    const callsBefore = service.getComments.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(service.getComments.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');
  });
});

/**
 * 筛选取数与页码的时序契约。
 *
 * 真实故障：切换筛选后，页码要等「新筛选的列表请求返回」才被改回 1。
 * 在这段网络窗口里 `page` 还停在上一个筛选的第 3 页，于是
 *   - 分页控件显示「第 3 页 / 共 3 页」，列表却是新筛选的第 1 页数据；
 *   - 窗口内的 refresh()/updateStatus() 会按旧页码去请求新筛选的数据；
 *   - 全量并行跑测试时，这个窗口会被调度延迟放大成可观测的失败
 *     （getComments 已收到 pending page=1，但 page 仍是 3）。
 *
 * 所以「切筛选/改关键词 → 页码归 1」必须与状态切换同一拍发生，
 * 而不是依赖异步响应；同时慢的旧请求晚到时不能覆盖新筛选的结果。
 */
describe('useAdminComments · 筛选切换与请求时序', () => {
  it('切筛选后页码立刻归 1，不等列表响应返回', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(3);
    });
    expect(result.current.page).toBe(3);

    // 新筛选的请求挂起：模拟真实网络尚未返回。
    const pending = deferred<PageResult>();
    service.getComments.mockReturnValueOnce(pending.promise);

    act(() => {
      result.current.setFilter('pending');
    });

    // 请求已经按「新筛选 + 第 1 页」发出，响应还没回来，页码就必须已经是 1。
    expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, PER_PAGE, '');
    expect(result.current.page).toBe(1);

    // 这段窗口里点刷新，取的也必须是新筛选的第 1 页，而不是上一个筛选的第 3 页。
    const refreshPending = deferred<PageResult>();
    service.getComments.mockReturnValueOnce(refreshPending.promise);
    act(() => {
      void result.current.refresh();
    });
    expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, PER_PAGE, '');

    await act(async () => {
      refreshPending.resolve({ items: [], totalItems: 0 });
      pending.resolve({ items: [], totalItems: 0 });
    });
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('改关键词后页码立刻归 1，不等列表响应返回', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(2);
    });
    expect(result.current.page).toBe(2);

    const pending = deferred<PageResult>();
    service.getComments.mockReturnValueOnce(pending.promise);

    act(() => {
      result.current.setQuery('huba');
    });

    expect(service.getComments).toHaveBeenLastCalledWith('all', 1, PER_PAGE, 'huba');
    expect(result.current.page).toBe(1);

    await act(async () => {
      pending.resolve({ items: [], totalItems: 0 });
    });
    expect(result.current.page).toBe(1);
  });

  it('连续快速切筛选：后到的旧响应不覆盖新筛选的列表与页码', async () => {
    const all = servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 第一次切筛选：请求慢
    const slowPending = deferred<PageResult>();
    service.getComments.mockReturnValueOnce(slowPending.promise);
    act(() => {
      result.current.setFilter('pending');
    });
    expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, PER_PAGE, '');

    // 紧接着再切一次：请求快，先返回
    const fastApproved = deferred<PageResult>();
    service.getComments.mockReturnValueOnce(fastApproved.promise);
    act(() => {
      result.current.setFilter('approved');
    });
    expect(service.getComments).toHaveBeenLastCalledWith('approved', 1, PER_PAGE, '');
    expect(result.current.page).toBe(1);

    await act(async () => {
      fastApproved.resolve({ items: [makeComment('approved-1', 'approved')], totalItems: 1 });
    });
    expect(result.current.comments.map((c) => c.id)).toEqual(['approved-1']);
    expect(result.current.totalItems).toBe(1);
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(false);

    // 旧筛选（pending）的响应晚到：不许把 approved 的结果覆盖回去。
    await act(async () => {
      slowPending.resolve({ items: all.slice(0, PER_PAGE), totalItems: all.length });
    });
    expect(result.current.comments.map((c) => c.id)).toEqual(['approved-1']);
    expect(result.current.totalItems).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('重复设置同一筛选不清空页码、不重复取数', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(2);
    });
    expect(result.current.page).toBe(2);
    const callsBefore = service.getComments.mock.calls.length;

    act(() => {
      result.current.setFilter('all');
    });

    expect(service.getComments.mock.calls.length).toBe(callsBefore);
    expect(result.current.page).toBe(2);
  });
});

describe('useAdminComments · 失败可见且可重试', () => {
  it('第 3 页失败：给出明确错误、保留第 2 页旧数据，重试仍请求第 3 页', async () => {
    servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(2);
    });
    const page2 = result.current.comments;

    service.getComments.mockRejectedValueOnce(forbidden);
    await act(async () => {
      await result.current.goToPage(3);
    });

    // 明确错误（describePbError 翻译 403），不是静默失败
    expect(result.current.error).toBe('没有执行该操作的权限');
    expect(result.current.loading).toBe(false);
    // 失败不清空列表：仍展示第 2 页数据，页码也停在最后一次成功页
    expect(result.current.comments).toEqual(page2);
    expect(result.current.page).toBe(2);

    // 重试请求的是失败的那一页，而不是跳回第 1 页
    await act(async () => {
      await result.current.retry();
    });
    expect(service.getComments).toHaveBeenLastCalledWith('all', 3, PER_PAGE, '');
    expect(result.current.page).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('首次加载失败不伪装「空列表 + 正常分页」', async () => {
    service.getComments.mockRejectedValue(forbidden);
    const { result } = renderHook(() => useAdminComments());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('没有执行该操作的权限');
    expect(result.current.comments).toEqual([]);
  });
});

describe('useAdminComments · 保留现有审核/批量语义', () => {
  it('审核/批量操作后按当前页重新取数', async () => {
    servePages(45);
    service.updateStatus.mockResolvedValue(undefined);
    service.batchUpdateStatus.mockResolvedValue(undefined);
    service.batchDelete.mockResolvedValue(undefined);
    service.deleteComment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.goToPage(2);
    });
    expect(result.current.page).toBe(2);

    await act(async () => {
      expect(await result.current.updateStatus('c21', 'approved')).toBe(true);
    });
    expect(service.updateStatus).toHaveBeenCalledWith('c21', 'approved');
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');

    await act(async () => {
      expect(await result.current.batchUpdateStatus(['c21', 'c22'], 'spam')).toBe(true);
    });
    expect(service.batchUpdateStatus).toHaveBeenCalledWith(['c21', 'c22'], 'spam');
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');

    await act(async () => {
      expect(await result.current.batchDelete(['c21'])).toBe(true);
    });
    expect(service.batchDelete).toHaveBeenCalledWith(['c21']);

    await act(async () => {
      expect(await result.current.deleteComment('c22')).toBe(true);
    });
    expect(service.deleteComment).toHaveBeenCalledWith('c22');
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');
  });

  it('末页被删空后收敛到真实最后一页，不停在空白页', async () => {
    const all = servePages(45);
    const { result } = renderHook(() => useAdminComments());
    await waitFor(() => expect(result.current.totalPages).toBe(3));

    // 第 3 页的 5 条被删掉：totalItems 缩到 40，请求第 3 页只会拿到空 items
    service.getComments.mockImplementation(
      async (_filter: string, page = 1, perPage = PER_PAGE) => {
        const remaining = all.slice(0, 40);
        return {
          items: remaining.slice((page - 1) * perPage, page * perPage),
          totalItems: remaining.length,
        };
      },
    );

    await act(async () => {
      await result.current.goToPage(3);
    });

    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, PER_PAGE, '');
    expect(result.current.page).toBe(2);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.comments).toHaveLength(20);
  });
});
