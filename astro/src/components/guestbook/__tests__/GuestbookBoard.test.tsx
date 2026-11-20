import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 留言板行为契约：
 * - 首屏失败显示错误态，重试会真实重新取数；
 * - 「加载更多」失败时就地提示并保留已经看到的留言（旧实现要么静默、
 *   要么把整面墙替换成加载骨架 / 首屏错误态）；
 * - 懒加载失败后重试会继续取下一页并追加；
 * - 已有留言时刷新失败也要可见、可重试，且不清空旧留言；
 * - 失败期间同一个动作只出现一个重试按钮，成功刷新 / 加载更多会清掉旧错误。
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

/** 通过表单真实提交一条留言：表单自己的钩子会先刷新一次第一页，然后才通知容器刷新。 */
function submitMessage(nickname: string, content: string) {
  fireEvent.change(screen.getByLabelText('昵称'), { target: { value: nickname } });
  fireEvent.change(screen.getByPlaceholderText(/说点什么吧/), { target: { value: content } });
  fireEvent.click(screen.getByRole('button', { name: '发布留言' }));
}

/** 当前可见的重试类按钮（刷新 / 加载更多），用于断言「同一时刻只有一个」。 */
function retryButtons() {
  return screen.getAllByRole('button').filter((button) => /重新加载|重试/.test(button.textContent ?? ''));
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

  it('已有留言时刷新失败：保留旧留言、提示刷新失败并可重试', async () => {
    getListMock
      .mockResolvedValueOnce(pageResult(1, [message('m1', '旧留言')], 1))
      // 表单自己的 postMessage 也会刷新一次第一页
      .mockResolvedValueOnce(pageResult(1, [message('m1', '旧留言')], 1))
      // 容器 onPosted 触发的刷新失败
      .mockRejectedValueOnce(new Error('refresh failed'))
      // 点「重新加载」后的真实重试
      .mockResolvedValueOnce(pageResult(1, [message('m2', '刷新后的留言')], 1));
    createMock.mockResolvedValue({ id: 'new' });

    render(<GuestbookBoard />);
    expect(await screen.findByText('旧留言')).toBeTruthy();

    submitMessage('HB', '新留言');

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('refresh-error');
    expect(alert.textContent).toContain('刷新失败');
    // 刷新失败不得清空/替换已经渲染的留言
    expect(screen.getByText('旧留言')).toBeTruthy();
    // 失败期间只保留一个重试入口
    expect(retryButtons()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('刷新后的留言')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('成功刷新会清掉上一次的「加载更多失败」提示', async () => {
    getListMock
      .mockResolvedValueOnce(pageResult(1, [message('m1', '旧留言')], 2))
      .mockRejectedValueOnce(new Error('page 2 failed'))
      // 表单自己的 postMessage 刷新第一页
      .mockResolvedValueOnce(pageResult(1, [message('m1', '旧留言')], 2))
      // 容器刷新第一页成功
      .mockResolvedValueOnce(pageResult(1, [message('m9', '新留言'), message('m1', '旧留言')], 1));
    createMock.mockResolvedValue({ id: 'new' });

    render(<GuestbookBoard />);
    expect(await screen.findByText('旧留言')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('load-more-error');

    submitMessage('HB', '新留言');

    expect(await screen.findByText('新留言')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('加载更多失败时只显示一个重试按钮', async () => {
    getListMock
      .mockResolvedValueOnce(pageResult(1, [message('m1', '第一条留言')], 2))
      .mockRejectedValueOnce(new Error('page 2 failed'));

    render(<GuestbookBoard />);
    expect(await screen.findByText('第一条留言')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByRole('alert');

    // 正常的「加载更多」让位给「重试加载更多」，同一动作不出现两个入口
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    const retries = retryButtons();
    expect(retries).toHaveLength(1);
    expect(retries[0].textContent).toContain('重试加载更多');
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
