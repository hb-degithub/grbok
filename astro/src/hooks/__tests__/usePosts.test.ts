import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Post } from '../../types/pocketbase';

/**
 * usePosts 行为契约（阅读路径：「失败可重试 + 不串页」）。
 *
 * 现状问题：
 * - 失败后只 setError，从不 setError(null)，所以「重试成功」在视图里仍然是失败态；
 * - 失败只能靠整页 reload 恢复，没有真正的重新取数入口；
 * - 请求没有序号/取消，切换页码后先发后到的旧响应会覆盖新页码的数据。
 *
 * 这里用假的 PocketBase 实例锁定行为，不 mock 整个 hook：
 *   - 失败 → retry() 真的重新请求 → 成功后 error 清空、数据与总页数更新；
 *   - retry() 保持当前页码；
 *   - 旧请求晚到不得覆盖新页码结果；
 *   - 标签不存在 / 标签下没有关联文章都返回真空态（无 error），且不查询文章；
 *   - 标签筛选仍走既有 tags + post_tags 关系，不改数据契约。
 */

const { getPocketBaseMock } = vi.hoisted(() => ({ getPocketBaseMock: vi.fn() }));

vi.mock('../../lib/services/authService', () => ({
  authService: { getPocketBase: getPocketBaseMock },
}));

import { usePosts } from '../usePocketBase';

interface ListResult {
  items: Post[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

function post(id: string): Post {
  return {
    id,
    title: `文章 ${id}`,
    slug: `post-${id}`,
    content: 'x'.repeat(300),
    excerpt: `摘要 ${id}`,
    cover: '',
    status: 'published',
    author: 'user-1',
    published_at: '2026-01-02T03:04:05.000Z',
    views: 0,
    created: '2026-01-02T03:04:05.000Z',
    updated: '2026-01-02T03:04:05.000Z',
  };
}

function list(items: Post[], totalPages = 1): ListResult {
  return { items, page: 1, perPage: 12, totalItems: items.length, totalPages };
}

/** 只实现 usePosts 用到的 `filter` / `collection(...).getList|getFullList`。 */
function createFakePb() {
  const tagsGetList = vi.fn();
  const postTagsGetFullList = vi.fn();
  const postsGetList = vi.fn();

  const pb = {
    // 与 PocketBase 的占位符语法一致：{:name} → 带引号的参数值。
    filter: (template: string, params: Record<string, unknown> = {}) =>
      template.replace(/\{:(\w+)\}/g, (_match, key: string) => JSON.stringify(params[key] ?? '')),
    collection: (name: string) => {
      if (name === 'tags') return { getList: tagsGetList };
      if (name === 'post_tags') return { getFullList: postTagsGetFullList };
      if (name === 'posts') return { getList: postsGetList };
      throw new Error(`unexpected collection: ${name}`);
    },
  };

  return { pb, tagsGetList, postTagsGetFullList, postsGetList };
}

let fake: ReturnType<typeof createFakePb>;

beforeEach(() => {
  fake = createFakePb();
  getPocketBaseMock.mockReturnValue(fake.pb);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePosts · 失败可重试', () => {
  it('首次失败后 retry() 真实重新取数，成功后清空 error 并渲染新数据', async () => {
    fake.postsGetList.mockRejectedValueOnce(new Error('PB 不可达'));
    fake.postsGetList.mockResolvedValueOnce(list([post('a')], 3));

    const { result } = renderHook(() => usePosts(1, 12));

    await waitFor(() => expect(result.current.error?.message).toBe('PB 不可达'));
    expect(result.current.loading).toBe(false);
    expect(result.current.posts).toEqual([]);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.posts[0]?.id).toBe('a');
    expect(result.current.totalPages).toBe(3);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fake.postsGetList).toHaveBeenCalledTimes(2);
    expect(fake.postsGetList).toHaveBeenLastCalledWith(
      1,
      12,
      expect.objectContaining({ expand: 'author' }),
    );
  });

  it('retry() 保持当前页码，不会把用户打回第一页', async () => {
    fake.postsGetList.mockRejectedValueOnce(new Error('boom'));
    fake.postsGetList.mockResolvedValueOnce(list([post('b')], 4));

    const { result } = renderHook(() => usePosts(3, 12));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.posts[0]?.id).toBe('b'));
    expect(fake.postsGetList).toHaveBeenLastCalledWith(
      3,
      12,
      expect.objectContaining({ sort: '-published_at' }),
    );
    expect(result.current.totalPages).toBe(4);
  });

  it('切换页码后，先发后到的旧请求不会覆盖新页码的数据', async () => {
    let resolveFirst: ((value: ListResult) => void) | undefined;
    fake.postsGetList.mockImplementationOnce(
      () =>
        new Promise<ListResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fake.postsGetList.mockResolvedValueOnce(list([post('page-2')], 5));

    const { result, rerender } = renderHook(({ page }: { page: number }) => usePosts(page, 12), {
      initialProps: { page: 1 },
    });

    await waitFor(() => expect(fake.postsGetList).toHaveBeenCalledTimes(1));
    rerender({ page: 2 });
    await waitFor(() => expect(result.current.posts[0]?.id).toBe('page-2'));

    await act(async () => {
      resolveFirst?.(list([post('page-1')], 5));
      await Promise.resolve();
    });

    expect(result.current.posts[0]?.id).toBe('page-2');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('usePosts · 标签筛选仍走 post_tags 关系', () => {
  it('标签不存在：真空态（无 error），且不查询文章', async () => {
    fake.tagsGetList.mockResolvedValue({ items: [] });

    const { result } = renderHook(() => usePosts(1, 12, 'no-such-tag'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.posts).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.totalPages).toBe(1);
    expect(fake.postsGetList).not.toHaveBeenCalled();
    expect(fake.tagsGetList).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({ filter: expect.stringContaining('slug') }),
    );
  });

  it('标签存在但没有 post_tags 关联：真空态，不查询文章', async () => {
    fake.tagsGetList.mockResolvedValue({ items: [{ id: 'tag-1' }] });
    fake.postTagsGetFullList.mockResolvedValue([]);

    const { result } = renderHook(() => usePosts(1, 12, 'react'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.posts).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(fake.postsGetList).not.toHaveBeenCalled();
  });

  it('标签存在时用关联 post_id 组成过滤条件，并保留已发布 + 倒序 + expand', async () => {
    fake.tagsGetList.mockResolvedValue({ items: [{ id: 'tag-1' }] });
    fake.postTagsGetFullList.mockResolvedValue([{ post_id: 'p1' }, { post_id: 'p2' }]);
    fake.postsGetList.mockResolvedValue(list([post('p1')], 1));

    const { result } = renderHook(() => usePosts(1, 12, 'react'));

    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(fake.postTagsGetFullList).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'post_id' }),
    );

    const [page, perPage, options] = fake.postsGetList.mock.calls[0] as [
      number,
      number,
      { filter: string; sort?: string; expand?: string },
    ];
    expect(page).toBe(1);
    expect(perPage).toBe(12);
    expect(options.filter).toContain('status = "published"');
    expect(options.filter).toContain('p1,p2');
    expect(options.sort).toBe('-published_at');
    expect(options.expand).toBe('author');
  });
});
