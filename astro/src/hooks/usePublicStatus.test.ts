import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { usePublicStatus } from './usePublicStatus';

/**
 * 共享公开状态 store 的行为契约（Task 2）。
 *
 * 这些测试只经过 hook 观察行为，不直接读 store 内部字段：
 * - 模块级去重：两个消费者只发一次请求，最后一个卸载才停止轮询；
 * - 三个来源（status / protection / ping）各自保留 loading / ready / failed，
 *   失败互不牵连，失败时绝不拿旧值或编造数字；
 * - protection 只有 state === 'ok' 才把 blocked 当真实 24h 拦截数；
 * - ping 只有 2xx 才算一次往返样本；
 * - 页面 hidden 暂停请求、visible 立即刷新；
 * - 请求序号 / AbortController 防止「后发先返回」的旧响应覆盖新结果；
 * - SSR 只用服务端初始快照，不发请求。
 */

type SourceKey = 'status' | 'protection' | 'ping';
type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

const STATUS_URL = '/api/public/status';
const PROTECTION_URL = '/api/public/protection';
const PING_URL = '/api/public/ping';

const OK_BODIES: Record<SourceKey, unknown> = {
  status: {
    overall: 'operational',
    services: [{ key: 'site', ok: true, avgLatency24h: 128, uptime24h: 99.94 }],
  },
  protection: { safeline: { state: 'ok', blocked: 3 } },
  ping: { pong: true },
};

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function badResponse(status = 503): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

function sourceOf(input: RequestInfo | URL): SourceKey | null {
  const url = String(input);
  if (url.startsWith(STATUS_URL)) return 'status';
  if (url.startsWith(PROTECTION_URL)) return 'protection';
  if (url.startsWith(PING_URL)) return 'ping';
  return null;
}

/** 只实现三个公开端点；其余路径直接抛错，避免测试悄悄放行。 */
function stubFetch(
  overrides: Partial<Record<SourceKey, () => Response | Promise<Response>>> = {},
): FetchMock {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const source = sourceOf(input);
    if (!source) throw new Error(`unexpected fetch: ${String(input)}`);
    const override = overrides[source];
    if (override) return Promise.resolve(override());
    return Promise.resolve(okJson(OK_BODIES[source]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: FetchMock, source: SourceKey): number {
  return fetchMock.mock.calls.reduce(
    (total, call) => (sourceOf(call[0] as RequestInfo | URL) === source ? total + 1 : total),
    0,
  );
}

/** 真实定时器下的微任务冲洗：让已 resolve 的 fetch 链把结果提交给 store。 */
async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * 模拟页面可见性。jsdom 的 visibilityState 是 Document.prototype 上的 getter，
 * 这里用自有属性覆盖并在 afterEach 还原，事件仍是真实的 visibilitychange。
 */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function restoreVisibility(): void {
  if (Object.getOwnPropertyDescriptor(document, 'visibilityState')) {
    Reflect.deleteProperty(document, 'visibilityState');
  }
}

describe('usePublicStatus · 模块级共享 store', () => {
  beforeEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreVisibility();
  });

  it('两个消费者共享一次状态请求，最后一个卸载才清理', async () => {
    const fetchMock = stubFetch();

    const first = renderHook(() => usePublicStatus());
    const second = renderHook(() => usePublicStatus());

    // 请求已发出但尚未落地时，两个消费者都是 loading（共享同一份初始快照）。
    expect(first.result.current.statusPhase).toBe('loading');
    expect(second.result.current.statusPhase).toBe('loading');

    await waitFor(() => expect(first.result.current.statusPhase).toBe('ready'));
    expect(second.result.current.statusPhase).toBe('ready');

    // 模块级去重：状态 / 防护各一次，ping 是 3 次实测采样（不是每个消费者各打一遍）。
    expect(callsTo(fetchMock, 'status')).toBe(1);
    expect(callsTo(fetchMock, 'protection')).toBe(1);
    expect(callsTo(fetchMock, 'ping')).toBe(3);
    expect(second.result.current.blocked24h).toBe(3);
    expect(second.result.current.safelineState).toBe('ok');
    expect(second.result.current.pingMs).toBeTypeOf('number');

    // 只剩一个消费者时数据照旧服务，不能因为另一个卸载就回到 loading。
    first.unmount();
    expect(second.result.current.statusPhase).toBe('ready');
    expect(second.result.current.status?.overall).toBe('operational');

    second.unmount();
  });

  it('三个来源分别保留失败，并拒绝不可信防护与非 2xx ping', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => badResponse()));

    const { result } = renderHook(() => usePublicStatus());

    await waitFor(() => expect(result.current.pingPhase).toBe('failed'));
    expect(result.current.statusPhase).toBe('failed');
    expect(result.current.protectionPhase).toBe('failed');
    expect(result.current.status).toBeNull();
    expect(result.current.blocked24h).toBeNull();
    expect(result.current.safelineState).toBeNull();
    expect(result.current.pingMs).toBeNull();
  });

  it('未落地前是 loading；SSR 渲染只读服务端快照且不发请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    function Probe() {
      const snapshot = usePublicStatus();
      return createElement(
        'span',
        null,
        `${snapshot.statusPhase}/${snapshot.protectionPhase}/${snapshot.pingPhase}`,
      );
    }

    const html = renderToString(createElement(Probe));

    expect(html).toContain('loading/loading/loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('只接受 state === "ok" 的拦截数：stale 时保留状态但不展示数字', async () => {
    stubFetch({ protection: () => okJson({ safeline: { state: 'stale', blocked: 42 } }) });

    const { result } = renderHook(() => usePublicStatus());

    await waitFor(() => expect(result.current.protectionPhase).toBe('ready'));
    expect(result.current.safelineState).toBe('stale');
    expect(result.current.blocked24h).toBeNull();
  });

  it('ping 只统计 2xx 往返：失败样本被跳过，成功样本仍产生延迟', async () => {
    let pingCalls = 0;
    const fetchMock = stubFetch({
      ping: () => {
        pingCalls += 1;
        return pingCalls === 1 ? badResponse(502) : okJson({ pong: true });
      },
    });

    const { result } = renderHook(() => usePublicStatus());

    await waitFor(() => expect(result.current.pingPhase).toBe('ready'));
    expect(result.current.pingMs).toBeTypeOf('number');
    expect(result.current.pingMs).toBeGreaterThanOrEqual(0);
    expect(callsTo(fetchMock, 'ping')).toBe(3);
  });

  it('后发请求先返回时不会覆盖新结果（请求序号 / AbortController）', async () => {
    const pendingStatus: Array<(body: unknown) => void> = [];
    const statusSignals: AbortSignal[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const source = sourceOf(input);
        if (source === 'status') {
          if (init?.signal) statusSignals.push(init.signal);
          return new Promise<Response>((resolve) => {
            pendingStatus.push((body) => resolve(okJson(body)));
          });
        }
        if (!source) throw new Error(`unexpected fetch: ${String(input)}`);
        return Promise.resolve(okJson(OK_BODIES[source]));
      }),
    );

    const { result } = renderHook(() => usePublicStatus());
    expect(pendingStatus).toHaveLength(1);

    // 第二次刷新：hidden 暂停 → visible 立即刷新，此时第一次状态请求仍挂起。
    setVisibility('hidden');
    setVisibility('visible');
    expect(pendingStatus).toHaveLength(2);
    // 上一轮在途请求被 AbortController 中止，不再继续占用连接。
    expect(statusSignals[0]?.aborted).toBe(true);
    expect(statusSignals[1]?.aborted).toBe(false);

    // 新请求先返回：operational。
    await act(async () => {
      pendingStatus[1]({ overall: 'operational', services: [] });
    });
    await waitFor(() => expect(result.current.statusPhase).toBe('ready'));
    expect(result.current.status?.overall).toBe('operational');

    // 旧请求后返回：outage。序号已过期，必须整条丢弃。
    await act(async () => {
      pendingStatus[0]({ overall: 'outage', services: [] });
    });
    await flushMicrotasks();
    expect(result.current.statusPhase).toBe('ready');
    expect(result.current.status?.overall).toBe('operational');
  });

  it('hidden 暂停轮询、visible 立即刷新，最后一个消费者卸载后清空 timer', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch();

    const first = renderHook(() => usePublicStatus());
    const second = renderHook(() => usePublicStatus());
    await flushMicrotasks();
    expect(first.result.current.statusPhase).toBe('ready');
    expect(callsTo(fetchMock, 'status')).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // hidden：不再发请求，也不再保留轮询 timer。
    setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(callsTo(fetchMock, 'status')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    // visible：立即刷新（不是等下一个 30s 周期），并恢复轮询。
    setVisibility('visible');
    expect(callsTo(fetchMock, 'status')).toBe(2);
    await flushMicrotasks();
    expect(second.result.current.statusPhase).toBe('ready');

    // 只剩一个订阅者时继续服务：30s 后仍会按时刷新。
    first.unmount();
    const before = callsTo(fetchMock, 'status');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(callsTo(fetchMock, 'status')).toBe(before + 1);
    expect(second.result.current.statusPhase).toBe('ready');

    // 最后一个卸载：timer 归零，再推进时间也不会发新请求。
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(callsTo(fetchMock, 'status')).toBe(before + 1);
  });
});
