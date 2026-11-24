import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * 留言治理 · AI 审核（使用真实 useGuestbookAdmin，只 mock 底层 guestbookService）。
 *
 * 契约：
 * - 每条留言可单独触发 AI 审核，成功后显示 verdict 徽章（通过/垃圾/存疑/失败）；
 * - spam 结论后该条状态变为隐藏（后端写 status='hide'）；
 * - 顶部「AI 审核全部」串行处理当前列表，单条失败不中断，并给出 x/y 进度与汇总；
 * - step-up 过期时停止后续请求并提示重新验证。
 */

const { serviceMock } = vi.hoisted(() => ({
  serviceMock: {
    getItems: vi.fn(),
    moderate: vi.fn(),
    toggleStatus: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../lib/services/guestbookService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/services/guestbookService')>();
  return { ...actual, guestbookService: serviceMock };
});

import type { GuestbookItem } from '../../../lib/services/guestbookService';
import GuestbookModerator from '../GuestbookModerator';

let db: GuestbookItem[] = [];

function message(id: string, nickname: string, status = 'show'): GuestbookItem {
  return {
    id,
    collectionId: 'guestbook_messages',
    collectionName: 'guestbook_messages',
    nickname,
    content: `${nickname} 的留言内容`,
    status,
    created: '2026-11-22 10:00:00.000Z',
    updated: '2026-11-22 10:00:00.000Z',
  } as GuestbookItem;
}

function seed(items: GuestbookItem[]) {
  db = items;
  serviceMock.getItems.mockImplementation(async () => db.map((item) => ({ ...item })));
}

beforeEach(() => {
  serviceMock.getItems.mockReset();
  serviceMock.moderate.mockReset();
  serviceMock.toggleStatus.mockReset();
  serviceMock.delete.mockReset();
  seed([message('m1', '阿甲')]);
});

afterEach(cleanup);

describe('GuestbookModerator · 单条 AI 审核', () => {
  it('调用审核接口，spam 后显示 AI 垃圾徽章且状态变为隐藏', async () => {
    serviceMock.moderate.mockImplementation(async (id: string) => {
      db = db.map((item) => item.id === id
        ? { ...item, status: 'hide', ai_verdict: 'spam', ai_reason: '包含广告关键词', ai_moderated: true }
        : item);
      return { verdict: 'spam', reason: '包含广告关键词', status: 'hide' };
    });

    render(<GuestbookModerator />);
    await screen.findByText('阿甲');

    fireEvent.click(screen.getByRole('button', { name: /AI 审核「阿甲」的留言/ }));

    await waitFor(() => expect(serviceMock.moderate).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('AI 垃圾')).toBeTruthy();
    expect(screen.getByText('隐藏')).toBeTruthy();
    expect(screen.getByText('包含广告关键词')).toBeTruthy();
  });

  it('approve 结论显示 AI 通过徽章', async () => {
    serviceMock.moderate.mockImplementation(async (id: string) => {
      db = db.map((item) => item.id === id
        ? { ...item, ai_verdict: 'approve', ai_reason: '正常留言', ai_moderated: true }
        : item);
      return { verdict: 'approve', reason: '正常留言', status: 'show' };
    });

    render(<GuestbookModerator />);
    await screen.findByText('阿甲');

    fireEvent.click(screen.getByRole('button', { name: /AI 审核「阿甲」的留言/ }));

    expect(await screen.findByText('AI 通过')).toBeTruthy();
    expect(screen.getByText('显示')).toBeTruthy();
  });
});

describe('GuestbookModerator · AI 审核全部', () => {
  it('串行处理当前列表，单条失败不中断，并展示进度与汇总', async () => {
    seed([message('m1', '甲'), message('m2', '乙'), message('m3', '丙')]);
    let inFlight = 0;
    serviceMock.moderate.mockImplementation(async (id: string) => {
      inFlight += 1;
      // 串行校验：任何时刻只允许一个请求在飞
      expect(inFlight).toBe(1);
      try {
        if (id === 'm2') throw new Error('上游超时');
        if (id === 'm1') return { verdict: 'approve', reason: '', status: 'show' };
        return { verdict: 'unsure', reason: '语义模糊', status: 'show' };
      } finally {
        inFlight -= 1;
      }
    });

    render(<GuestbookModerator />);
    await screen.findByText('甲');

    fireEvent.click(screen.getByRole('button', { name: /AI 审核全部/ }));

    await waitFor(() => expect(serviceMock.moderate).toHaveBeenCalledTimes(3));
    // 单条失败不中断：第三条仍被处理
    expect(serviceMock.moderate).toHaveBeenNthCalledWith(1, 'm1');
    expect(serviceMock.moderate).toHaveBeenNthCalledWith(2, 'm2');
    expect(serviceMock.moderate).toHaveBeenNthCalledWith(3, 'm3');

    await waitFor(() =>
      expect(screen.getByText(/AI 审核完成：通过 1 \/ 隐藏 0 \/ 存疑 1 \/ 失败 1/)).toBeTruthy(),
    );
    expect(screen.getByText(/已完成 3\/3/)).toBeTruthy();
  });

  it('spam 汇总计入「隐藏」', async () => {
    seed([message('m1', '甲'), message('m2', '乙')]);
    serviceMock.moderate.mockResolvedValue({ verdict: 'spam', reason: '垃圾', status: 'hide' });

    render(<GuestbookModerator />);
    await screen.findByText('甲');

    fireEvent.click(screen.getByRole('button', { name: /AI 审核全部/ }));

    await waitFor(() =>
      expect(screen.getByText(/AI 审核完成：通过 0 \/ 隐藏 2 \/ 存疑 0 \/ 失败 0/)).toBeTruthy(),
    );
  });

  it('step-up 过期时停止后续审核并提示重新验证', async () => {
    seed([message('m1', '甲'), message('m2', '乙')]);
    const stepUpError = Object.assign(new Error('ADMIN_STEP_UP_REQUIRED'), {
      status: 403,
      response: { data: { code: 'ADMIN_STEP_UP_REQUIRED' } },
    });
    serviceMock.moderate.mockRejectedValue(stepUpError);

    render(<GuestbookModerator />);
    await screen.findByText('甲');

    fireEvent.click(screen.getByRole('button', { name: /AI 审核全部/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('管理会话已过期'));
    // 第一条即 step-up 失败，不再继续请求第二条
    expect(serviceMock.moderate).toHaveBeenCalledTimes(1);
  });
});
