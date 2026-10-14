import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type PocketBase from 'pocketbase';
import {
  cachedCall,
  cachedFetchJson,
  clearPbResponseCache,
  wrapPocketBaseSend,
  PB_CACHE_TTL_MS,
} from './pb-cache';

/** 最小可用的 PocketBase 替身：只有 send 与 authStore。 */
function fakePb(token = '') {
  const send = vi.fn<(path: string, options?: Record<string, unknown>) => Promise<unknown>>();
  const pb = { send, authStore: { token } } as unknown as PocketBase;
  return { pb, send };
}

beforeEach(() => {
  clearPbResponseCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cachedCall', () => {
  it('TTL 内命中缓存，底层只执行一次', async () => {
    const fn = vi.fn().mockResolvedValue({ n: 1 });
    const a = await cachedCall('k1', 1000, fn);
    const b = await cachedCall('k1', 1000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
  });

  it('命中返回深拷贝，调用方互不影响', async () => {
    const fn = vi.fn().mockResolvedValue({ list: [1, 2, 3] });
    const a = await cachedCall<{ list: number[] }>('k2', 1000, fn);
    a.list.push(4);
    const b = await cachedCall<{ list: number[] }>('k2', 1000, fn);
    expect(b.list).toEqual([1, 2, 3]);
  });

  it('TTL 过期后重新执行底层请求', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('v');
    await cachedCall('k3', 1000, fn);
    vi.advanceTimersByTime(1500);
    await cachedCall('k3', 1000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('并发调用合并为一次底层请求（single-flight）', async () => {
    let resolveFn: (v: string) => void = () => {};
    const fn = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFn = resolve; }),
    );
    const p1 = cachedCall('k4', 1000, fn);
    const p2 = cachedCall('k4', 1000, fn);
    resolveFn('done');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toBe('done');
    expect(r2).toBe('done');
  });

  it('失败响应不缓存，下一次重试底层请求', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    await expect(cachedCall('k5', 1000, fn)).rejects.toThrow('boom');
    await expect(cachedCall('k5', 1000, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('cachedFetchJson', () => {
  it('HTTP 非 2xx 抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(cachedFetchJson('http://x/api')).rejects.toThrow('HTTP 500');
  });

  it('成功响应被缓存，第二次不再发起 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ v: 7 }) });
    vi.stubGlobal('fetch', fetchMock);
    const a = await cachedFetchJson<{ v: number }>('http://x/api2');
    const b = await cachedFetchJson<{ v: number }>('http://x/api2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.v).toBe(7);
    expect(b.v).toBe(7);
  });
});

describe('wrapPocketBaseSend', () => {
  it('匿名 GET 走缓存', async () => {
    const { pb, send } = fakePb();
    send.mockResolvedValue({ items: [] });
    wrapPocketBaseSend(pb);
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('query 字段顺序不同视为同一请求', async () => {
    const { pb, send } = fakePb();
    send.mockResolvedValue({ items: [] });
    wrapPocketBaseSend(pb);
    await pb.send('/x', { filter: 'a', sort: '-created' });
    await pb.send('/x', { sort: '-created', filter: 'a' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('带 auth token 的 GET 不缓存', async () => {
    const { pb, send } = fakePb('admin-token');
    send.mockResolvedValue({ items: [] });
    wrapPocketBaseSend(pb);
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('非 GET 写请求成功后清空缓存', async () => {
    const { pb, send } = fakePb();
    send.mockResolvedValue({ ok: true });
    wrapPocketBaseSend(pb);
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    await pb.send('/api/collections/comments/records', { method: 'POST', body: {} });
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('写请求失败不清空缓存', async () => {
    const { pb, send } = fakePb();
    send.mockImplementation((path: string, options?: Record<string, unknown>) => {
      if (options?.method === 'POST') return Promise.reject(new Error('write failed'));
      return Promise.resolve({ items: [1] });
    });
    wrapPocketBaseSend(pb);
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    await expect(pb.send('/x', { method: 'POST' })).rejects.toThrow('write failed');
    await pb.send('/api/collections/posts/records', { filter: 'a' });
    // 缓存未被清空：第二次 GET 命中缓存，底层只有 GET+POST 共 2 次调用
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('重复包装幂等', async () => {
    const { pb, send } = fakePb();
    send.mockResolvedValue(1);
    wrapPocketBaseSend(pb);
    wrapPocketBaseSend(pb);
    await pb.send('/x', {});
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('缓存 key 不受 RequestInit 字段（signal/method 大小写）影响', async () => {
    const { pb, send } = fakePb();
    send.mockResolvedValue({ ok: 1 });
    wrapPocketBaseSend(pb);
    await pb.send('/x', { filter: 'a', signal: undefined });
    await pb.send('/x', { filter: 'a', method: 'get' });
    // method 非 GET 才绕过；'get' 大写后仍算 GET → 命中缓存
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('clearPbResponseCache', () => {
  it('清空后重新请求', async () => {
    const fn = vi.fn().mockResolvedValue('v');
    await cachedCall('kc', PB_CACHE_TTL_MS, fn);
    clearPbResponseCache();
    await cachedCall('kc', PB_CACHE_TTL_MS, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
