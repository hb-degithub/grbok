import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import StatusPanel from '../StatusPanel';

/**
 * 运行状态面板契约：
 * - 加载中 / 接口失败 / 空服务列表 / 正常数据四态可区分；
 * - 接口失败显示可重试的错误提示，重试会真实重新请求 /api/public/status；
 * - 探针数据仍然来自真实接口响应（不伪造数字）。
 */

const baseStatus = {
  now: '2026-11-20 09:00:00',
  overall: 'operational',
  services: [
    {
      key: 'web',
      label: '主站',
      ok: true,
      latencyMs: 12,
      lastCheck: '2026-11-20 09:00:00',
      uptime24h: 99.9,
      avgLatency24h: 20,
      recent: [{ t: '2026-11-20 08:59:00', ok: true, ms: 120 }],
    },
  ],
  host: null,
};

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response;
}

function pingResponse() {
  return { ok: true, headers: { get: () => null } } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/public/status')) return jsonResponse(baseStatus);
    return pingResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StatusPanel · 加载 / 错误 / 空数据', () => {
  it('加载中显示加载文案，不伪装成错误或空数据', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    render(<StatusPanel />);

    expect(screen.getByText('状态加载中…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // 主机采样未就绪与「状态加载中」区分
    expect(screen.getByText(/主机性能采样尚未就绪/)).toBeTruthy();
  });

  it('状态接口失败时显示可重试错误，重试成功后展示真实服务', async () => {
    let statusCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/public/status')) {
        statusCalls += 1;
        if (statusCalls === 1) throw new Error('status down');
        return jsonResponse(baseStatus);
      }
      return pingResponse();
    });

    render(<StatusPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('状态接口请求失败');
    expect(screen.getByText('状态接口暂时不可用')).toBeTruthy();
    expect(screen.queryByText('状态加载中…')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试状态' }));

    expect(await screen.findByText('所有系统运行正常')).toBeTruthy();
    expect(screen.getByText('主站')).toBeTruthy();
    expect(screen.getByText('12ms')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('服务列表为空与失败态可区分', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/public/status')) {
        return jsonResponse({ ...baseStatus, services: [] });
      }
      return pingResponse();
    });

    render(<StatusPanel />);

    expect(await screen.findByText('所有系统运行正常')).toBeTruthy();
    expect(screen.getByText('服务列表尚未配置。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('主机数据到达后展示真实占用与规格', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/public/status')) {
        return jsonResponse({
          ...baseStatus,
          host: {
            cpuPct: 21,
            memPct: 48,
            diskPct: 62,
            rxKbps: 128,
            txKbps: 64,
            load1: 0.42,
            cpuCores: 4,
            memTotalMb: 8192,
            at: '2026-11-20 09:00:00',
          },
        });
      }
      return pingResponse();
    });

    render(<StatusPanel />);

    expect(await screen.findByText('服务器性能')).toBeTruthy();
    expect(screen.getByText('21%')).toBeTruthy();
    expect(screen.getByText('48%')).toBeTruthy();
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.queryByText(/主机性能采样尚未就绪/)).toBeNull();
  });
});
