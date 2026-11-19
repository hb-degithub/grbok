import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import type { Post } from '../../types/pocketbase';

/**
 * PostList 回归测试：阅读页的「编号行 + 细线分隔 + 可分享页码」。
 *
 * 锁定的行为契约：
 *   - 加载中 / 加载失败 / 空列表三态仍存在，且语义角色不变（status / alert）；
 *   - 失败态的重试按钮触发 usePosts 的真实重新取数（不再整页 reload）；
 *   - 每篇文章仍然来自 usePosts，不在本地造数据；
 *   - 序号跨分页连续（第 2 页从 perPage+1 开始），便于当索引用；
 *   - 分页按钮保留 aria-label / aria-current，点击切换页码并重新取数；
 *   - 阅读页开启 syncPageQuery 时，页码通过 history.replaceState 写回 ?page=；
 *     回到第 1 页移除参数；未开启（首页嵌入列表）时不改写 URL；
 *   - initialPage 决定首屏取数页码，非法值收敛到 1，越界页码收敛到最后一页。
 */

const { mockUsePosts } = vi.hoisted(() => ({ mockUsePosts: vi.fn() }));

vi.mock('../../hooks/usePocketBase', () => ({
  usePosts: mockUsePosts,
}));

// 列表不再按断点切换布局；仍 mock 掉，避免 jsdom 缺少 matchMedia 的噪声。
vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    currentBreakpoint: 'desktop',
    prefersReducedMotion: false,
  }),
}));

import PostList from './PostList';

const usePostsMock = vi.mocked(mockUsePosts);

function makePost(page: number, index: number): Post {
  return {
    id: `p-${page}-${index}`,
    title: `第 ${page} 页第 ${index + 1} 篇`,
    slug: `post-${page}-${index}`,
    content: 'x'.repeat(300),
    excerpt: `摘要 ${page}-${index}`,
    cover: '',
    status: 'published',
    author: 'user-1',
    published_at: '2026-01-02T03:04:05.000Z',
    views: 0,
    created: '2026-01-02T03:04:05.000Z',
    updated: '2026-01-02T03:04:05.000Z',
  };
}

function postsForPage(page: number, count = 12): Post[] {
  return Array.from({ length: count }, (_, i) => makePost(page, i));
}

function mockState(state: {
  posts?: Post[];
  loading?: boolean;
  error?: Error | null;
  totalPages?: number;
  retry?: () => void;
}) {
  usePostsMock.mockReturnValue({
    posts: state.posts ?? [],
    loading: state.loading ?? false,
    error: state.error ?? null,
    totalPages: state.totalPages ?? 1,
    retry: state.retry ?? vi.fn(),
  } as unknown as ReturnType<typeof mockUsePosts>);
}

describe('PostList（编号行列表）', () => {
  beforeEach(() => {
    cleanup();
    usePostsMock.mockReset();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('加载中：保留 status 语义与加载提示', () => {
    mockState({ loading: true });
    render(<PostList perPage={12} />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-label')).toBe('加载中');
    expect(status.textContent).toContain('正在加载文章');
  });

  it('加载失败：保留 alert 语义；重试按钮触发真实重新取数而不是整页 reload', () => {
    const retry = vi.fn();
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost:3000/posts', reload },
    });

    mockState({ error: new Error('boom'), retry });
    render(<PostList perPage={12} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('加载失败，请稍后重试')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('空列表：保留空态文案', () => {
    mockState({ posts: [] });
    render(<PostList perPage={12} />);

    expect(screen.getByText('暂无文章')).toBeTruthy();
  });

  it('渲染 usePosts 返回的全部文章，序号从 01 开始', () => {
    mockState({ posts: postsForPage(1, 12) });
    render(<PostList perPage={12} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText('第 1 页第 1 篇')).toBeTruthy();
    expect(screen.getByText('第 1 页第 12 篇')).toBeTruthy();
  });

  it('分页：页码按钮可访问，当前页带 aria-current', () => {
    mockState({ posts: postsForPage(1), totalPages: 3 });
    render(<PostList perPage={12} />);

    const nav = screen.getByRole('navigation', { name: '文章分页' });
    expect(nav).toBeTruthy();

    const pageButtons = screen.getAllByRole('button', { name: /^第 \d+ 页$/ });
    expect(pageButtons).toHaveLength(3);
    expect(pageButtons[0].getAttribute('aria-current')).toBe('page');
    expect(pageButtons[1].getAttribute('aria-current')).toBeNull();
  });

  it('切换分页：重新按新页码取数，且编号跨页连续', () => {
    usePostsMock.mockImplementation(((page: number) => ({
      posts: postsForPage(page),
      loading: false,
      error: null,
      totalPages: 3,
      retry: vi.fn(),
    })) as unknown as typeof mockUsePosts);

    render(<PostList perPage={12} />);
    expect(screen.getByText('01')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));

    expect(usePostsMock).toHaveBeenLastCalledWith(2, 12, undefined);
    expect(screen.getByText('13')).toBeTruthy();
    expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page');
  });

  it('initialPage 决定首屏取数页码（?page= 由页面 SSR 传入）', () => {
    mockState({ posts: postsForPage(3, 1), totalPages: 3 });
    render(<PostList perPage={12} initialPage={3} />);

    expect(usePostsMock).toHaveBeenCalledWith(3, 12, undefined);
    expect(screen.getByRole('button', { name: '第 3 页' }).getAttribute('aria-current')).toBe('page');
  });

  it('initialPage 非法值（0 / NaN / 负数）收敛到第 1 页', () => {
    mockState({ posts: postsForPage(1, 1) });

    const { unmount } = render(<PostList perPage={12} initialPage={0} />);
    expect(usePostsMock).toHaveBeenLastCalledWith(1, 12, undefined);
    unmount();

    render(<PostList perPage={12} initialPage={Number.NaN} />);
    expect(usePostsMock).toHaveBeenLastCalledWith(1, 12, undefined);
  });

  it('syncPageQuery：翻页用 replaceState 写回 ?page=，不新增历史条目', () => {
    mockState({ posts: postsForPage(1), totalPages: 3 });
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    render(<PostList perPage={12} syncPageQuery />);
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }));

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(String(replaceState.mock.calls[0]?.[2] ?? '')).toContain('page=3');
  });

  it('syncPageQuery：回到第 1 页时移除 ?page=，URL 保持干净', () => {
    window.history.replaceState(null, '', '/posts?page=3');
    mockState({ posts: postsForPage(1), totalPages: 3 });
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    render(<PostList perPage={12} initialPage={3} syncPageQuery />);
    fireEvent.click(screen.getByRole('button', { name: '第 1 页' }));

    const target = String(replaceState.mock.calls[0]?.[2] ?? '');
    expect(target).not.toContain('page=');
    expect(target).toContain('/posts');
  });

  it('未开启 syncPageQuery 的嵌入列表（首页）不改写 URL', () => {
    mockState({ posts: postsForPage(1), totalPages: 3 });
    const replaceState = vi.spyOn(window.history, 'replaceState');

    render(<PostList perPage={6} />);
    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('URL 页码越界时收敛到最后一页，避免把「有数据」显示成「暂无文章」', async () => {
    usePostsMock.mockImplementation(((page: number) => ({
      posts: page <= 3 ? postsForPage(page, 1) : [],
      loading: false,
      error: null,
      totalPages: 3,
      retry: vi.fn(),
    })) as unknown as typeof mockUsePosts);

    render(<PostList perPage={12} initialPage={99} />);

    await waitFor(() => expect(usePostsMock).toHaveBeenLastCalledWith(3, 12, undefined));
  });

  it('tagSlug 透传给 usePosts（标签筛选不被改造丢弃）', () => {
    mockState({ posts: postsForPage(1, 1) });
    render(<PostList perPage={12} tagSlug="react" />);

    expect(usePostsMock).toHaveBeenCalledWith(1, 12, 'react');
  });

  it('单页时不渲染分页导航', () => {
    mockState({ posts: postsForPage(1, 3), totalPages: 1 });
    render(<PostList perPage={12} />);

    expect(screen.queryByRole('navigation', { name: '文章分页' })).toBeNull();
  });
});
