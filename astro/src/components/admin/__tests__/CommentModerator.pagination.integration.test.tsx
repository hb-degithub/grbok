import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 评论审核页（CommentModerator）分页取数回归测试。
 *
 * 使用**真实的 useAdminComments**（只 mock 底层 adminCommentService），
 * 覆盖「点下一页 → service 收到 page=2 → 列表换成第 2 页」的端到端行为，
 * 而不是只测 hook 返回值。
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

vi.mock('../../../lib/services/aiSettingsService', () => ({
  getAiSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../lib/services/aiAssistService', () => ({
  moderateComment: vi.fn(),
  replyComment: vi.fn(),
}));

vi.mock('../../../components/ui/Toast', () => ({
  showToast: vi.fn(),
  default: () => null,
}));

vi.mock('../../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    user: { id: 'me', email: 'me@example.com', role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
    role: 'admin',
    hasPermission: () => true,
  }),
}));

import type { Comment } from '../../../lib/services/adminCommentService';
import CommentModerator from '../CommentModerator';

function makeComment(id: string): Comment {
  return {
    id,
    post: 'post-1',
    author_name: `作者 ${id}`,
    author_email: `${id}@example.com`,
    content: `内容 ${id}`,
    status: 'pending',
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
    expand: { post: { id: 'post-1', title: '测试文章', slug: 'test-post' } },
  };
}

/** 模拟 PocketBase 分页：默认 45 条 → 3 页（20/20/5）。 */
function servePages(count = 45) {
  const all = Array.from({ length: count }, (_, i) => makeComment(`c${i + 1}`));
  service.getComments.mockImplementation(
    async (_filter: string, page = 1, perPage = 20) => ({
      items: all.slice((page - 1) * perPage, page * perPage),
      totalItems: all.length,
    }),
  );
  return all;
}

beforeEach(() => {
  service.getComments.mockReset();
  service.updateStatus.mockReset();
  service.updateContent.mockReset();
  service.batchUpdateStatus.mockReset();
  service.batchDelete.mockReset();
  service.deleteComment.mockReset();
});

afterEach(cleanup);

describe('CommentModerator · 分页真正取数', () => {
  it('点「下一页」让 service 收到 page=2，并渲染第 2 页评论', async () => {
    servePages(45);
    render(<CommentModerator />);

    await waitFor(() => expect(screen.getByText('作者 c1')).toBeTruthy());
    expect(service.getComments).toHaveBeenLastCalledWith('all', 1, 20, '');
    expect(screen.getByText(/第 1\/3 页/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() =>
      expect(service.getComments).toHaveBeenLastCalledWith('all', 2, 20, ''),
    );
    await waitFor(() => expect(screen.getByText('作者 c21')).toBeTruthy());

    // 列表确实换成了第 2 页，而不是只改页码
    expect(screen.queryByText('作者 c1')).toBeNull();
    expect(screen.getByText(/第 2\/3 页/)).toBeTruthy();
  });

  it('点页码按钮取对应页；末页禁用「下一页」，「上一页」可回退', async () => {
    servePages(45);
    render(<CommentModerator />);
    await waitFor(() => expect(screen.getByText('作者 c1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByText('作者 c21')).toBeTruthy());
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, 20, '');

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('作者 c41')).toBeTruthy());
    expect(service.getComments).toHaveBeenLastCalledWith('all', 3, 20, '');
    expect(
      (screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => expect(screen.getByText('作者 c21')).toBeTruthy());
    expect(service.getComments).toHaveBeenLastCalledWith('all', 2, 20, '');
  });

  it('切换筛选回到第 1 页取数', async () => {
    servePages(45);
    render(<CommentModerator />);
    await waitFor(() => expect(screen.getByText('作者 c1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('作者 c21')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '待审核' }));

    await waitFor(() =>
      expect(service.getComments).toHaveBeenLastCalledWith('pending', 1, 20, ''),
    );
    expect(screen.getByText(/第 1\/3 页/)).toBeTruthy();
  });

  it('取数失败显示明确错误并可重试（重试请求失败的那一页）', async () => {
    servePages(45);
    render(<CommentModerator />);
    await waitFor(() => expect(screen.getByText('作者 c1')).toBeTruthy());

    // 先成功进入第 2 页
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('作者 c21')).toBeTruthy());

    service.getComments.mockRejectedValueOnce({
      status: 403,
      message: 'Forbidden',
      response: { data: { message: '没有执行该操作的权限' } },
    });

    fireEvent.click(screen.getByRole('button', { name: '3' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('没有执行该操作的权限'),
    );
    // 失败时旧数据保留，不会变成空列表
    expect(screen.getByText('作者 c21')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() =>
      expect(service.getComments).toHaveBeenLastCalledWith('all', 3, 20, ''),
    );
    await waitFor(() => expect(screen.getByText('作者 c41')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('首次加载失败不显示「没有找到评论」伪空态', async () => {
    service.getComments.mockRejectedValue({
      status: 403,
      message: 'Forbidden',
      response: { data: { message: '没有执行该操作的权限' } },
    });

    render(<CommentModerator />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('没有执行该操作的权限'),
    );
    expect(screen.queryByText('没有找到评论。')).toBeNull();
    expect(screen.getByText('统计不可用')).toBeTruthy();
  });
});
