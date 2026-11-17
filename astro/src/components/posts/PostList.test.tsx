import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import type { Post } from '../../types/pocketbase';

/**
 * PostList 回归测试：科幻简约改造后列表为「编号行 + 细线分隔」。
 *
 * 锁定的行为契约：
 *   - 加载中 / 加载失败 / 空列表三态仍存在，且语义角色不变（status / alert）；
 *   - 失败态保留「重试」按钮，点击走整页重载；
 *   - 每篇文章仍然来自 usePosts，不本地造数据；
 *   - 序号跨分页连续（第 2 页从 perPage+1 开始），便于当索引用；
 *   - 分页按钮保留 aria-label / aria-current，点击切换页码并重新取数。
 */

const { mockUsePosts } = vi.hoisted(() => ({ mockUsePosts: vi.fn() }));

vi.mock('../../hooks/usePocketBase', () => ({
  usePosts: mockUsePosts,
}));

// 改造后列表不再按断点切换布局；仍 mock 掉，避免 jsdom 缺少 matchMedia 的噪声。
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
}) {
  usePostsMock.mockReturnValue({
    posts: state.posts ?? [],
    loading: state.loading ?? false,
    error: state.error ?? null,
    totalPages: state.totalPages ?? 1,
  } as unknown as ReturnType<typeof mockUsePosts>);
}

describe('PostList（编号行列表）', () => {
  beforeEach(() => {
    cleanup();
    usePostsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('加载中：保留 status 语义与加载提示', () => {
    mockState({ loading: true });
    render(<PostList perPage={12} />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-label')).toBe('加载中');
    expect(status.textContent).toContain('正在加载文章');
  });

  it('加载失败：保留 alert 语义与重试按钮，点击重载页面', () => {
    mockState({ error: new Error('boom') });

    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { reload },
    });

    render(<PostList perPage={12} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('加载失败，请稍后重试')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(reload).toHaveBeenCalledTimes(1);
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
    })) as unknown as typeof mockUsePosts);

    render(<PostList perPage={12} />);
    expect(screen.getByText('01')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));

    expect(usePostsMock).toHaveBeenLastCalledWith(2, 12, undefined);
    expect(screen.getByText('13')).toBeTruthy();
    expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page');
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
