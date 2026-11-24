import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 评论审核 · 批量 AI 审核入口。
 *
 * 契约：
 * - 按钮上带全站待审数量徽标（不依赖当前筛选页）；
 * - 筛选不在 pending 时仍可点击：当前页没有待审行就去拉待审列表补齐；
 * - 串行调用审核接口，完成后给出通过/驳回/存疑/失败汇总。
 */

const { serviceMock, aiMock } = vi.hoisted(() => ({
  serviceMock: {
    getComments: vi.fn(),
    getPendingCount: vi.fn(),
    updateStatus: vi.fn(),
    updateContent: vi.fn(),
    batchUpdateStatus: vi.fn(),
    batchDelete: vi.fn(),
    deleteComment: vi.fn(),
  },
  aiMock: {
    moderateComment: vi.fn(),
    replyComment: vi.fn(),
  },
}));

vi.mock('../../../lib/services/adminCommentService', () => ({ adminCommentService: serviceMock }));
vi.mock('../../../lib/services/aiAssistService', () => aiMock);
vi.mock('../../../lib/services/aiSettingsService', () => ({
  getAiSettings: vi.fn().mockResolvedValue(null),
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

function makeComment(id: string, status: Comment['status']): Comment {
  return {
    id,
    post: 'post-1',
    author_name: `作者 ${id}`,
    author_email: `${id}@example.com`,
    content: `内容 ${id}`,
    status,
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
    expand: { post: { id: 'post-1', title: '测试文章', slug: 'test-post' } },
  };
}

const pending = [makeComment('p1', 'pending'), makeComment('p2', 'pending')];
const approved = [makeComment('a1', 'approved')];

beforeEach(() => {
  serviceMock.getComments.mockReset();
  serviceMock.getPendingCount.mockReset();
  serviceMock.updateStatus.mockReset();
  serviceMock.updateContent.mockReset();
  serviceMock.batchUpdateStatus.mockReset();
  serviceMock.batchDelete.mockReset();
  serviceMock.deleteComment.mockReset();
  aiMock.moderateComment.mockReset();
  aiMock.replyComment.mockReset();

  serviceMock.getComments.mockImplementation(async (filter: string) => {
    if (filter === 'pending') return { items: pending, totalItems: pending.length };
    return { items: approved, totalItems: approved.length };
  });
  serviceMock.getPendingCount.mockResolvedValue(2);
});

afterEach(cleanup);

async function findBatchButton() {
  return screen.findByRole('button', { name: /AI 审核全部待审/ });
}

describe('CommentModerator · 批量 AI 审核入口', () => {
  it('按钮显示全站待审数量徽标（即使当前列表没有待审行）', async () => {
    render(<CommentModerator />);

    const button = await findBatchButton();
    await waitFor(() => expect(screen.getByTestId('ai-pending-badge').textContent).toBe('2'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('筛选在「全部」时也能批量审核：自动拉取待审列表并串行处理', async () => {
    aiMock.moderateComment.mockImplementation(async (id: string) => ({
      verdict: id === 'p2' ? 'spam' : 'approve',
      reason: '',
      status: id === 'p2' ? 'spam' : 'approved',
    }));

    render(<CommentModerator />);
    await screen.findByText('作者 a1');

    fireEvent.click(await findBatchButton());

    await waitFor(() => expect(aiMock.moderateComment).toHaveBeenCalledTimes(2));
    expect(serviceMock.getComments).toHaveBeenCalledWith('pending', 1, 100);
    expect(aiMock.moderateComment).toHaveBeenNthCalledWith(1, 'p1');
    expect(aiMock.moderateComment).toHaveBeenNthCalledWith(2, 'p2');

    await waitFor(() =>
      expect(screen.getByText(/AI 批量审核完成：通过 1 \/ 驳回 1 \/ 存疑 0 \/ 失败 0/)).toBeTruthy(),
    );
  });

  it('没有待审评论时按钮禁用且徽标为 0', async () => {
    serviceMock.getPendingCount.mockResolvedValue(0);
    render(<CommentModerator />);

    const button = await findBatchButton();
    await waitFor(() => expect(screen.getByTestId('ai-pending-badge').textContent).toBe('0'));
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
