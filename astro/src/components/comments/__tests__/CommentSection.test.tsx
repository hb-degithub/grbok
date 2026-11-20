import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NestedComment } from '../../../types/pocketbase';

/**
 * 评论区容器行为契约（阅读路径 · 评论体验）。
 *
 * 关注用户可见结果：
 *   1. 首次加载已存在的评论不能被误标成「NEW」；只有之后新到达的评论高亮 3 秒；
 *   2. 高亮计时按批次清理：3 秒内 comments 再变化（update/父组件重渲染）
 *      不能让已启动的计时器被清掉后永久粘滞；
 *   3. 「加载更多」追加的是更早的历史评论，不能标成 NEW；
 *   4. 空评论区收到的第一条实时评论要能高亮；嵌套回复也要传递 isNew；
 *   5. 评论总数、加载更多、错误重试、关闭评论都有明确可读状态。
 *
 * useComments / useSiteSettings 用可控替身，避免真实网络；CommentItem 使用真实组件，
 * 因此这里同时验证渲染链路（sanitizeText、嵌套递归）没有被破坏。
 */

const commentsHook = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
const settingsHook = vi.hoisted(() => ({
  state: { settings: {}, loading: false },
}));

vi.mock('../../../hooks/useComments', () => ({
  useComments: () => commentsHook.state,
}));

vi.mock('../../../hooks/useSiteSettings', () => ({
  useSiteSettings: () => settingsHook.state,
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn(() => null),
  onAuthChange: vi.fn(() => () => {}),
  getUserEmail: vi.fn(() => null as string | null),
  getUserEmailVerified: vi.fn(() => undefined as boolean | undefined),
}));

vi.mock('../../../lib/services/authService', () => ({ authService: auth }));

vi.mock('../../../lib/pocketbase', () => ({
  getPocketBase: () => ({ authStore: { isValid: false, record: null } }),
}));

vi.mock('../../../lib/services/commentService', () => ({
  commentService: {
    likeComment: vi.fn(),
    unlikeComment: vi.fn(),
    reportComment: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    sendVerificationCode: vi.fn(),
  },
}));

import CommentSection from '../CommentSection';

function comment(over: Partial<NestedComment> & { id: string }): NestedComment {
  return {
    post_id: 'post-1',
    author_name: '读者',
    content: '一条评论',
    parent_id: null,
    status: 'approved',
    created: new Date('2026-11-20T00:00:00Z').toISOString(),
    updated: new Date('2026-11-20T00:00:00Z').toISOString(),
    likes: 0,
    children: [],
    ...over,
  } as NestedComment;
}

const baseState = () => ({
  comments: [] as NestedComment[],
  loading: false,
  loadingMore: false,
  error: null as Error | null,
  submitError: null as string | null,
  page: 1,
  totalPages: 1,
  totalItems: 0,
  hasMore: false,
  submitComment: vi.fn().mockResolvedValue(true),
  refresh: vi.fn(),
  loadMore: vi.fn(),
});

function setState(over: Record<string, unknown> = {}) {
  commentsHook.state = { ...baseState(), ...over };
  return commentsHook.state as ReturnType<typeof baseState>;
}

beforeEach(() => {
  settingsHook.state = {
    settings: { enable_comments: true, comment_moderation: true },
    loading: false,
  };
  setState();
  cleanup();
});

afterEach(cleanup);

describe('评论区 · 首次加载与 NEW 高亮', () => {
  it('首次加载已有评论不误标 NEW', () => {
    setState({
      comments: [comment({ id: 'c1', content: '第一条' }), comment({ id: 'c2', content: '第二条' })],
      totalItems: 2,
    });

    render(<CommentSection postId="post-1" />);

    expect(screen.queryByText('NEW')).toBeNull();
    expect(screen.getByText('第一条')).toBeTruthy();
    expect(screen.getByText('2 条评论')).toBeTruthy();
  });

  it('实时新增的评论只高亮新评论，3 秒后消退', async () => {
    setState({ comments: [comment({ id: 'c1', content: '第一条' })], totalItems: 1 });
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.queryByText('NEW')).toBeNull();

    commentsHook.state = {
      ...commentsHook.state,
      comments: [
        comment({ id: 'c1', content: '第一条' }),
        comment({ id: 'c2', content: '刚刚到达' }),
      ],
      totalItems: 2,
    };
    rerender(<CommentSection postId="post-1" />);

    await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(1));
    expect(screen.getByText('刚刚到达')).toBeTruthy();

    await waitFor(() => expect(screen.queryByText('NEW')).toBeNull(), { timeout: 4500 });
  }, 10_000);

  it('3 秒内 comments 再次变化后 NEW 仍按时消退，不会永久粘滞', async () => {
    setState({ comments: [comment({ id: 'c1', content: '第一条' })], totalItems: 1 });
    const { rerender } = render(<CommentSection postId="post-1" />);

    commentsHook.state = {
      ...commentsHook.state,
      comments: [comment({ id: 'c1', content: '第一条' }), comment({ id: 'c2', content: '刚刚到达' })],
      totalItems: 2,
    };
    rerender(<CommentSection postId="post-1" />);
    await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(1));

    // 同一批 id 再变一次（例如 update 推送或父组件重渲染）——计时器不能被清掉后失业
    commentsHook.state = {
      ...commentsHook.state,
      comments: [
        comment({ id: 'c1', content: '第一条（已更新）' }),
        comment({ id: 'c2', content: '刚刚到达（已更新）' }),
      ],
    };
    rerender(<CommentSection postId="post-1" />);
    expect(screen.getAllByText('NEW')).toHaveLength(1);

    await waitFor(() => expect(screen.queryByText('NEW')).toBeNull(), { timeout: 4500 });
  }, 10_000);

  it('加载更多追加的历史评论不会被标成 NEW', () => {
    setState({
      comments: [comment({ id: 'c1', content: '第一条' })],
      totalItems: 3,
      totalPages: 2,
      hasMore: true,
      page: 1,
    });
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.queryByText('NEW')).toBeNull();

    commentsHook.state = {
      ...commentsHook.state,
      comments: [
        comment({ id: 'c1', content: '第一条' }),
        comment({ id: 'c0', content: '更早的历史评论' }),
      ],
      page: 2,
      hasMore: false,
    };
    rerender(<CommentSection postId="post-1" />);

    expect(screen.getByText('更早的历史评论')).toBeTruthy();
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('空评论区收到的第一条实时评论会高亮', async () => {
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.getByText('还没有评论')).toBeTruthy();
    expect(screen.queryByText('NEW')).toBeNull();

    commentsHook.state = {
      ...commentsHook.state,
      comments: [comment({ id: 'c1', content: '第一条实时评论' })],
      totalItems: 1,
    };
    rerender(<CommentSection postId="post-1" />);

    await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(1));
    expect(screen.getByText('第一条实时评论')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('NEW')).toBeNull(), { timeout: 4500 });
  }, 10_000);

  it('首屏仍在加载时为空列表不算基线：加载出的已有评论不标 NEW', () => {
    setState({ comments: [], loading: true });
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.getByText('正在加载评论…')).toBeTruthy();

    commentsHook.state = {
      ...commentsHook.state,
      comments: [comment({ id: 'c1', content: '加载出的第一条' }), comment({ id: 'c2', content: '加载出的第二条' })],
      loading: false,
      totalItems: 2,
    };
    rerender(<CommentSection postId="post-1" />);

    expect(screen.getByText('加载出的第一条')).toBeTruthy();
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('加载失败后重试成功：已有评论作为快照基线，不标 NEW', () => {
    setState({ comments: [], loading: false, error: new Error('网络错误') });
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.getByText('加载评论失败')).toBeTruthy();

    commentsHook.state = { ...commentsHook.state, comments: [], loading: true, error: null };
    rerender(<CommentSection postId="post-1" />);

    commentsHook.state = {
      ...commentsHook.state,
      comments: [comment({ id: 'c1', content: '重试后加载的评论' })],
      loading: false,
      totalItems: 1,
    };
    rerender(<CommentSection postId="post-1" />);

    expect(screen.getByText('重试后加载的评论')).toBeTruthy();
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('嵌套回复到达时子项也显示 NEW，并随计时消退', async () => {
    setState({ comments: [comment({ id: 'c1', content: '父评论' })], totalItems: 1 });
    const { rerender } = render(<CommentSection postId="post-1" />);
    expect(screen.queryByText('NEW')).toBeNull();

    commentsHook.state = {
      ...commentsHook.state,
      comments: [
        comment({
          id: 'c1',
          content: '父评论',
          children: [comment({ id: 'r1', content: '子回复', parent_id: 'c1' })],
        }),
      ],
      totalItems: 2,
    };
    rerender(<CommentSection postId="post-1" />);

    await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(1));
    const replyArticle = screen.getByText('子回复').closest('article');
    expect(replyArticle?.textContent).toContain('NEW');
    await waitFor(() => expect(screen.queryByText('NEW')).toBeNull(), { timeout: 4500 });
  }, 10_000);

  it('评论总数是一个 polite live region，数量变化可被播报', () => {
    setState({
      comments: [comment({ id: 'c1' }), comment({ id: 'c2' })],
      totalItems: 2,
    });

    render(<CommentSection postId="post-1" />);

    const count = screen.getByText('2 条评论');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.getAttribute('aria-atomic')).toBe('true');
  });
});

describe('评论区 · 状态与操作', () => {
  it('加载失败显示可重试错误，重试重新取数', () => {
    const state = setState({ error: new Error('网络错误') });

    render(<CommentSection postId="post-1" />);

    expect(screen.getByRole('alert').textContent).toContain('加载评论失败');
    expect(screen.getByRole('alert').textContent).toContain('网络错误');
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it('关闭评论时不展示表单，只说明关闭原因', () => {
    settingsHook.state = {
      settings: { enable_comments: false, comment_moderation: true },
      loading: false,
    };

    render(<CommentSection postId="post-1" />);

    expect(screen.getByText('评论已关闭')).toBeTruthy();
    expect(screen.queryByLabelText('评论内容')).toBeNull();
  });

  it('无评论时显示空态而不是错误态', () => {
    render(<CommentSection postId="post-1" />);
    expect(screen.getByText('还没有评论')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('0 条评论')).toBeTruthy();
  });

  it('加载更多显示剩余条数，提交中禁用按钮', () => {
    const state = setState({
      comments: [comment({ id: 'c1' }), comment({ id: 'c2' })],
      totalItems: 5,
      totalPages: 3,
      hasMore: true,
    });

    const { rerender } = render(<CommentSection postId="post-1" />);
    const more = screen.getByRole('button', { name: '加载更多（3 条）' });

    fireEvent.click(more);
    expect(state.loadMore).toHaveBeenCalledTimes(1);

    commentsHook.state = { ...commentsHook.state, loadingMore: true };
    rerender(<CommentSection postId="post-1" />);

    const loadingMore = screen.getByRole('button', { name: '加载中...' }) as HTMLButtonElement;
    expect(loadingMore.disabled).toBe(true);
    expect(loadingMore.getAttribute('aria-busy')).toBe('true');
  });

  it('加载中显示骨架与 aria-busy，而不是空态', () => {
    setState({ loading: true });

    render(<CommentSection postId="post-1" />);

    const section = screen.getByText('正在加载评论…').closest('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('还没有评论')).toBeNull();
  });
});
