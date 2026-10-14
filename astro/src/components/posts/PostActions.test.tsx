import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

// 组件只依赖 getPocketBase().authStore 判断登录态；真实 PB 客户端不需要。
vi.mock('../../lib/pocketbase', () => ({
  getPocketBase: vi.fn(),
}));

vi.mock('../../lib/services/postService', () => ({
  postService: {
    likePost: vi.fn(),
    unlikePost: vi.fn(),
    bookmarkPost: vi.fn(),
    unbookmarkPost: vi.fn(),
  },
}));

vi.mock('../../lib/services/actionRequest', () => ({
  actionRequestHeaders: vi.fn(() => ({ 'X-Browser-Fingerprint': 'afp-test' })),
  isAuthRequiredError: vi.fn(() => false),
  isRateLimitedError: vi.fn(() => false),
}));

import PostActions from './PostActions';
import { getPocketBase } from '../../lib/pocketbase';
import { postService } from '../../lib/services/postService';
import { isAuthRequiredError } from '../../lib/services/actionRequest';

const getPocketBaseMock = vi.mocked(getPocketBase);
const likePostMock = vi.mocked(postService.likePost);
const unlikePostMock = vi.mocked(postService.unlikePost);
const bookmarkPostMock = vi.mocked(postService.bookmarkPost);
const unbookmarkPostMock = vi.mocked(postService.unbookmarkPost);
const isAuthRequiredErrorMock = vi.mocked(isAuthRequiredError);

function setAuthState(valid: boolean) {
  getPocketBaseMock.mockReturnValue({
    authStore: {
      isValid: valid,
      record: valid ? { id: 'user-1', email: 'reader@example.com' } : null,
    },
  } as never);
}

describe('PostActions（点赞/收藏必须登录）', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    isAuthRequiredErrorMock.mockReturnValue(false);
  });

  it('匿名访客点击点赞：不调用服务端，给出「请先登录」提示，计数不变', async () => {
    setAuthState(false);
    render(<PostActions postId="post-1" initialLikes={7} />);

    const likeButton = await screen.findByRole('button', { name: '点赞' });
    fireEvent.click(likeButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('请先登录');
    expect(screen.getByRole('status').textContent).toContain('登录');
    expect(likePostMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '点赞' }).textContent).toContain('7');
    expect(screen.getByRole('button', { name: '点赞' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('匿名访客点击收藏：不调用服务端，给出「请先登录」提示', async () => {
    setAuthState(false);
    render(<PostActions postId="post-1" initialLikes={0} />);

    fireEvent.click(await screen.findByRole('button', { name: '收藏' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('请先登录');
    });
    expect(bookmarkPostMock).not.toHaveBeenCalled();
  });

  it('已登录用户点赞：调用 POST 服务并以服务端返回的 likes 为准', async () => {
    setAuthState(true);
    likePostMock.mockResolvedValue({ ok: true, likes: 8 });
    render(<PostActions postId="post-1" initialLikes={7} />);

    const likeButton = await screen.findByRole('button', { name: '点赞' });
    await waitFor(() => {
      expect(likeButton.getAttribute('title')).toBeNull();
    });
    fireEvent.click(likeButton);

    await waitFor(() => {
      expect(likePostMock).toHaveBeenCalledWith('post-1');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消点赞' }).textContent).toContain('8');
    });
    expect(screen.getByRole('button', { name: '取消点赞' }).getAttribute('aria-pressed')).toBe('true');
    expect(unlikePostMock).not.toHaveBeenCalled();
  });

  it('已登录用户再次点击：调用 DELETE 取消点赞，计数回落', async () => {
    setAuthState(true);
    likePostMock.mockResolvedValue({ ok: true, likes: 8 });
    unlikePostMock.mockResolvedValue({ ok: true, likes: 7, removed: true });
    render(<PostActions postId="post-1" initialLikes={7} />);

    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消点赞' }));
    });

    fireEvent.click(screen.getByRole('button', { name: '取消点赞' }));

    await waitFor(() => {
      expect(unlikePostMock).toHaveBeenCalledWith('post-1');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '点赞' }).textContent).toContain('7');
    });
    expect(screen.getByRole('button', { name: '点赞' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('已登录用户收藏/取消收藏：分别走 POST 与 DELETE', async () => {
    setAuthState(true);
    bookmarkPostMock.mockResolvedValue({ ok: true, bookmarked: true, count: 3 });
    unbookmarkPostMock.mockResolvedValue({ ok: true, bookmarked: false, count: 2, removed: true });
    render(<PostActions postId="post-1" initialLikes={0} />);

    fireEvent.click(await screen.findByRole('button', { name: '收藏' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消收藏' }));
    });
    expect(bookmarkPostMock).toHaveBeenCalledWith('post-1');

    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
    await waitFor(() => {
      expect(unbookmarkPostMock).toHaveBeenCalledWith('post-1');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收藏' }));
    });
  });

  it('服务端返回 401：降级为登录态失效并提示「请先登录」', async () => {
    setAuthState(true);
    isAuthRequiredErrorMock.mockReturnValue(true);
    likePostMock.mockRejectedValue({ status: 401 });
    render(<PostActions postId="post-1" initialLikes={5} />);

    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('请先登录');
    });
    // 不得本地假装 +1
    expect(screen.getByRole('button', { name: '点赞' }).textContent).toContain('5');
  });
});
