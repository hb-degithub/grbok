import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ProtectionPanel from '../ProtectionPanel';

/**
 * 安全防护面板契约：
 * - 首次加载显示加载文案，不把「尚未接入」当成加载中；
 * - 接口失败显示可重试错误，重试走真实重新请求；
 * - 有数据时展示真实统计数字（不虚构）。
 */

const baseProtection = {
  now: '2026-11-20T09:00:00.000Z',
  safeline: {
    state: 'ok',
    updatedAt: '2026-11-20T08:59:00.000Z',
    windowHours: 24,
    detected: 128,
    blocked: 7,
  },
  esa: { state: 'unconfigured' },
  challenge: { state: 'ok' },
};

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(baseProtection));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProtectionPanel · 加载 / 错误 / 数据', () => {
  it('首次加载显示加载文案，不显示「尚未接入」', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    render(<ProtectionPanel />);

    expect(screen.getByText('防护统计加载中…')).toBeTruthy();
    expect(screen.queryByText(/雷池拦截统计尚未接入或无数据/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('接口失败显示可重试错误，重试成功后展示真实数字', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('protection down');
      return jsonResponse(baseProtection);
    });

    render(<ProtectionPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('防护统计接口暂时不可用');

    fireEvent.click(screen.getByRole('button', { name: '重试防护统计' }));

    expect(await screen.findByText('128')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('接口可用但无统计数字时展示真实空态', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        ...baseProtection,
        safeline: { ...baseProtection.safeline, state: 'unavailable', detected: null, blocked: null },
      }),
    );

    render(<ProtectionPanel />);

    expect(await screen.findByText(/雷池拦截统计尚未接入或无数据/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
