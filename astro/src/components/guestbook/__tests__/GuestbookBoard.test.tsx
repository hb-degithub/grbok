import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 留言板行为契约：
 * - 首屏失败显示错误态，重试会真实重新取数；
 * - 「加载更多」失败时就地提示并保留已经看到的留言（旧实现要么静默、
 *   要么把整面墙替换成加载骨架 / 首屏错误态）；
 * - 懒加载失败后重试会继续取下一页并追加。
 */

const { getListMock, createMock } = vi.hoisted(() => ({
  getListMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('../../../lib/pocketbase', () => ({
  getPocketBase: () => ({
    collection: () => ({ getList: getListMock, create: createMock }),
  }),
}));

import GuestbookBoard from '../GuestbookBoard';

function message(id: string, content: string) {
  return { id, nickname: 'HB', content, created: '2026-01-01T00:00:00.000Z' };
}

function pageResult(page: number, items: ReturnType<typeof message>[], totalPages = 2) {
  return { page, perPage: 20, totalItems: items.length * 2, totalPages, items };
}

beforeEach(() => {
  getListMock.mockReset();
  createMock.mockReset();
});

afterEach(cleanup);

describe('GuestbookBoard · 分页与失败可见', () => {
  it('加载更多失败时就地提示并保留已有留言', async () => {
    getListMock
      .mockResolvedValueOnce(pageResult(1, [message('m1', '第一条留言')]))
      .mockRejectedValueOnce(new Error('page 2 failed'))
      .mockResolvedValueOnce(pageResult(2, [message('m2', '第二条留言')]));

    render(<GuestbookBoard />);
    expect(await screen.findByText('第一条留言')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('load-more-error');
    expect(alert.textContent).toContain('加载更多失败');
    // 失败不得清空/替换已经渲染的留言
    expect(screen.getByText('第一条留言')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试加载更多' }));
    expect(await screen.findByText('第二条留言')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/加载更多失败/)).toBeNull());
  });

  it('首屏失败显示错误态，重试成功后渲染留言', async () => {
    getListMock.mockRejectedValueOnce(new Error('boom'));

    render(<GuestbookBoard />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('留言加载失败');
    expect(screen.queryByText('还没有留言，来抢沙发～')).toBeNull();

    getListMock.mockResolvedValueOnce(pageResult(1, [message('m1', '重试后的留言')], 1));
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByText('重试后的留言')).toBeTruthy();
  });

  it('首屏加载时只显示骨架，不显示「暂无留言」', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    getListMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    render(<GuestbookBoard />);
    expect(screen.queryByText('还没有留言，来抢沙发～')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('留言加载中');

    resolveFirst(pageResult(1, [], 1));
    expect(await screen.findByText('还没有留言，来抢沙发～')).toBeTruthy();
  });
});
