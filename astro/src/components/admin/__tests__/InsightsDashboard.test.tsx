import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * 数据看板容错渲染契约（2026-11 生产缺陷回归）。
 *
 * 线上 reactions 集合匿名 403，旧实现让整个 Promise.all 失败，
 * 看板只剩「统计数据暂不可用」。新契约：
 * - reactions 降级 → 指标照常渲染 + 一句「部分互动数据不可用」；
 * - 统计接口降级但互动排行可用 → 渲染排行，不给整页空白；
 * - 两个数据源都不可用才是真正的「统计数据暂不可用」。
 */

const { snapshotMock } = vi.hoisted(() => ({
  snapshotMock: vi.fn(),
}));

vi.mock('../../../lib/services/insightsService', () => ({
  insightsService: { getInsightsSnapshot: snapshotMock },
}));

import InsightsDashboard from '../InsightsDashboard';

const STATS = {
  range: '7d',
  totalViews: 1234,
  todayViews: 56,
  uniqueVisitors: 78,
  daily: [
    { date: '2026-11-21', views: 600 },
    { date: '2026-11-22', views: 634 },
  ],
  topPages: [{ path: '/posts/hot', views: 900 }],
  topReferrers: [{ referrer: 'https://example.com', views: 12 }],
  detail: { uaCategories: [{ category: 'desktop', views: 900 }] },
};

const TOP_POSTS = [
  { postId: 'aaaaaaaaaaaaaaa', title: '高热度文章', views: 900, reactions: 0, comments: 0, score: 900 },
];

const ALL_OK = { stats: true, posts: true, reactions: true, comments: true };

afterEach(() => {
  cleanup();
  snapshotMock.mockReset();
});

describe('InsightsDashboard · 部分数据不可用', () => {
  it('reactions 不可用时仍渲染统计指标，并给出轻量提示', async () => {
    snapshotMock.mockResolvedValue({
      stats: STATS,
      topPosts: TOP_POSTS,
      availability: { ...ALL_OK, reactions: false },
      partial: true,
    });

    render(<InsightsDashboard />);

    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(screen.getByText('78')).toBeTruthy();
    expect(screen.getByText('高热度文章')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('部分互动数据不可用');
    // 关键断言：不再整页「统计数据暂不可用」
    expect(screen.queryByText('统计数据暂不可用')).toBeNull();
  });

  it('统计接口失败但互动排行可用时，仍渲染排行而不是空白页', async () => {
    snapshotMock.mockResolvedValue({
      stats: null,
      topPosts: TOP_POSTS,
      availability: { stats: false, posts: true, reactions: true, comments: true },
      partial: true,
    });

    render(<InsightsDashboard />);

    expect(await screen.findByText('高热度文章')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('统计数据接口暂不可用');
    await waitFor(() => expect(screen.queryByText('统计数据暂不可用')).toBeNull());
  });

  it('两个数据源都不可用才显示「统计数据暂不可用」', async () => {
    snapshotMock.mockResolvedValue({
      stats: null,
      topPosts: [],
      availability: { stats: false, posts: false, reactions: false, comments: false },
      partial: true,
    });

    render(<InsightsDashboard />);

    expect(await screen.findByText('统计数据暂不可用')).toBeTruthy();
  });

  it('互动接口不可用时统计照常渲染，排行榜显示「互动数据暂不可用」', async () => {
    snapshotMock.mockResolvedValue({
      stats: STATS,
      topPosts: [],
      availability: { stats: true, posts: false, reactions: false, comments: false },
      partial: true,
    });

    render(<InsightsDashboard />);

    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(screen.getByText('互动数据暂不可用')).toBeTruthy();
    // 不是整页空白，也不是把失败伪装成「暂无数据」
    expect(screen.queryByText('暂无数据')).toBeNull();
    expect(screen.queryByText('统计数据暂不可用')).toBeNull();
  });

  it('全部可用时不出现任何降级提示', async () => {
    snapshotMock.mockResolvedValue({
      stats: STATS,
      topPosts: TOP_POSTS,
      availability: ALL_OK,
      partial: false,
    });

    render(<InsightsDashboard />);

    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/部分互动数据不可用/)).toBeNull();
  });
});
