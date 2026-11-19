import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

/**
 * RequestPath 的真实链路状态矩阵。
 *
 * 这里 mock 的是**共享公开状态 store**（`usePublicStatus`），不是组件内部的
 * fetch / setInterval。这样测试只验证「快照 → 真实链路文案」的映射：
 *   - ok / outage / unknown 三态文案；
 *   - 无 services、gateway 有/无、safeline 的 ok/stale/unavailable/失败；
 *   - Caddy 这一跳没有独立采集目标，永远「未采集」+「无逐跳探测」，且 /status 失败时
 *     改说「采集失败」而不是把失败伪装成未采集；
 *   - gateway 采集目标是 admin-auth（认证与邮件网关），只出现在拓扑之外的独立标注里，
 *     不能被算成 Caddy 的 24h 平均响应；
 *   - 未采集就显示「未采集」或「—」，绝不出现估算毫秒数；
 *   - 接口失败不显示「运行正常」；
 *   - RequestPath 自己不再发请求、不再建轮询。
 */

interface TestSnapshot {
  status: { overall?: string; services?: Array<{ key: string; ok: boolean | null; avgLatency24h: number | null; uptime24h: number | null }> } | null;
  statusPhase: 'loading' | 'ready' | 'failed';
  protectionPhase: 'loading' | 'ready' | 'failed';
  pingPhase: 'loading' | 'ready' | 'failed';
  blocked24h: number | null;
  pingMs: number | null;
  safelineState: 'ok' | 'stale' | 'unavailable' | null;
}

const store = vi.hoisted(() => ({
  snapshot: null as unknown as TestSnapshot,
}));

vi.mock('../../hooks/usePublicStatus', () => ({
  usePublicStatus: () => store.snapshot,
}));

import RequestPath from './RequestPath';

const loadingSnapshot = (): TestSnapshot => ({
  status: null,
  statusPhase: 'loading',
  protectionPhase: 'loading',
  pingPhase: 'loading',
  blocked24h: null,
  pingMs: null,
  safelineState: null,
});

const readySnapshot = (patch: Partial<TestSnapshot> = {}): TestSnapshot => ({
  ...loadingSnapshot(),
  statusPhase: 'ready',
  protectionPhase: 'ready',
  pingPhase: 'ready',
  status: { overall: 'operational', services: [] },
  ...patch,
});

/** 取某一个 hop 的列表项，避免不同行同名字段互相干扰。 */
function hop(container: HTMLElement, name: string): HTMLElement {
  const items = Array.from(container.querySelectorAll('li'));
  const found = items.find((item) => item.textContent?.includes(name));
  if (!found) throw new Error(`未找到链路节点：${name}`);
  return found as HTMLElement;
}

function renderWith(snapshot: TestSnapshot): HTMLElement {
  store.snapshot = snapshot;
  const { container } = render(<RequestPath />);
  return container as HTMLElement;
}

/** `gateway`（admin-auth 认证与邮件网关）的独立标注块；它不属于 5 跳拓扑。 */
function gatewaySidecar(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-request-sidecar="gateway"]');
}

beforeEach(() => {
  store.snapshot = loadingSnapshot();
  // 组件若绕过共享 store 自己请求，测试必须立刻暴露，而不是静默走网络。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('RequestPath 不应自行发起请求，应消费 usePublicStatus');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RequestPath · 加载与失败', () => {
  it('加载中：aria-busy=true、骨架可见，且不出现任何状态结论', () => {
    const container = renderWith(loadingSnapshot());

    expect(screen.getByRole('list', { name: '真实请求链路' }).getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('检测中');
    expect(container.textContent).not.toContain('运行正常');
    expect(container.textContent).not.toContain('部分异常');
    expect(screen.getAllByText('指标读取中').length).toBeGreaterThan(0);
    // 未加载完就下结论（未采集 / 采集失败）等于伪造状态。
    expect(hop(container, 'Caddy').textContent).not.toContain('未采集');
    expect(hop(container, 'Caddy').textContent).not.toContain('采集失败');
  });

  it('三个来源全部失败：回退「检测中」，不显示运行正常与任何毫秒估算', () => {
    const container = renderWith({
      ...loadingSnapshot(),
      statusPhase: 'failed',
      protectionPhase: 'failed',
      pingPhase: 'failed',
    });

    expect(container.textContent).toContain('检测中');
    expect(container.textContent).not.toContain('运行正常');
    expect(container.textContent).not.toContain('部分异常');
    // 接口失败时只能出现「采集失败」/「—」，不能把失败渲染成正常毫秒数。
    expect(container.textContent).not.toMatch(/\d+\s*ms/);

    // 失败 ≠ 未采集：Caddy 这一行必须说清是 /status 接口挂了。
    const caddy = hop(container, 'Caddy');
    expect(caddy.textContent).toContain('采集失败');
    expect(caddy.textContent).toContain('状态接口失败');
    expect(caddy.textContent).not.toContain('未采集');
    expect(caddy.textContent).not.toContain('无逐跳探测');
    expect(container.textContent).not.toContain('未采集');
    // 没有 services 就没有 gateway 数据，独立标注块不该凭空出现。
    expect(gatewaySidecar(container)).toBeNull();
    expect(screen.getByRole('list', { name: '真实请求链路' }).getAttribute('aria-busy')).toBe('false');
  });

  it('请求组件自己不再调用 fetch（数据只来自共享 store）', () => {
    renderWith(readySnapshot());
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('RequestPath · overall 三态', () => {
  it('operational：运行正常，并渲染真实服务指标', () => {
    const container = renderWith(
      readySnapshot({
        status: {
          overall: 'operational',
          services: [
            { key: 'site', ok: true, avgLatency24h: 128, uptime24h: 99.94 },
            { key: 'api', ok: true, avgLatency24h: 44, uptime24h: null },
            { key: 'gateway', ok: true, avgLatency24h: 58, uptime24h: null },
          ],
        },
        blocked24h: 42,
        safelineState: 'ok',
        pingMs: 37,
      }),
    );

    expect(container.textContent).toContain('运行正常');
    expect(screen.getByRole('list', { name: '真实请求链路' }).getAttribute('aria-busy')).toBe('false');

    expect(hop(container, 'ESA 边缘').textContent).toContain('37 ms');
    expect(hop(container, '雷池 SafeLine').textContent).toContain('采集中');
    expect(hop(container, '雷池 SafeLine').textContent).toContain('42');
    // gateway=58 是 admin-auth 的 24h 均值，不能被当成 Caddy 的响应时间。
    expect(hop(container, 'Caddy').textContent).toContain('未采集');
    expect(hop(container, 'Caddy').textContent).toContain('无逐跳探测');
    expect(hop(container, 'Caddy').textContent).not.toContain('58 ms');
    expect(gatewaySidecar(container)?.textContent).toContain('认证与邮件网关');
    expect(gatewaySidecar(container)?.textContent).toContain('58 ms');
    expect(hop(container, 'Astro SSR').textContent).toContain('128 ms');
    expect(hop(container, 'Astro SSR').textContent).toContain('99.94%');
    expect(hop(container, 'PocketBase').textContent).toContain('正常');
    expect(hop(container, 'PocketBase').textContent).toContain('44 ms');
  });

  it('outage：部分异常，绝不显示运行正常', () => {
    const container = renderWith(
      readySnapshot({
        status: {
          overall: 'outage',
          services: [{ key: 'site', ok: false, avgLatency24h: null, uptime24h: null }],
        },
      }),
    );

    expect(container.textContent).toContain('部分异常');
    expect(container.textContent).not.toContain('运行正常');
  });

  it('unknown / 未识别的 overall：回退检测中，不崩溃', () => {
    const container = renderWith(
      readySnapshot({ status: { overall: 'maintenance', services: [] } }),
    );

    expect(container.textContent).toContain('检测中');
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('运行正常');
  });
});

describe('RequestPath · 无 services 与 gateway 有无', () => {
  it('status 完全没有 services：Caddy 显示未采集，SSR / PB 用占位符而不是估算值', () => {
    const container = renderWith(readySnapshot({ status: { overall: 'operational' } }));

    expect(container.textContent).not.toContain('undefined');
    expect(hop(container, 'Caddy').textContent).toContain('未采集');
    expect(hop(container, 'Caddy').textContent).toContain('无逐跳探测');
    expect(hop(container, 'Astro SSR').textContent).toContain('—');
    expect(hop(container, 'PocketBase').textContent).toContain('—');
    expect(gatewaySidecar(container)).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s*ms/);
  });

  it('有 gateway 采集目标：Caddy 仍是「未采集」，数值归到独立的「认证与邮件网关」标注', () => {
    const container = renderWith(
      readySnapshot({
        status: {
          overall: 'operational',
          services: [{ key: 'gateway', ok: true, avgLatency24h: 58, uptime24h: null }],
        },
      }),
    );

    const caddy = hop(container, 'Caddy');
    expect(caddy.textContent).toContain('未采集');
    expect(caddy.textContent).toContain('无逐跳探测');
    expect(caddy.textContent).not.toContain('58 ms');
    expect(caddy.textContent).not.toContain('24h 平均响应');

    const gateway = gatewaySidecar(container);
    expect(gateway, 'gateway 数据必须单独标注，不能塞进 Caddy 节点').not.toBeNull();
    expect(gateway?.textContent).toContain('认证与邮件网关');
    expect(gateway?.textContent).toContain('admin-auth');
    expect(gateway?.textContent).toContain('24h 平均响应');
    expect(gateway?.textContent).toContain('58 ms');
    expect(gateway?.textContent).not.toContain('采集异常');

    // 5 跳拓扑结构不变：gateway 不是链路节点。
    const list = screen.getByRole('list', { name: '真实请求链路' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).queryByText(/认证与邮件网关/)).toBeNull();
  });

  it('gateway 采样异常：独立标注里写「采集异常」，不漏报也不冒充正常', () => {
    const container = renderWith(
      readySnapshot({
        status: {
          overall: 'outage',
          services: [{ key: 'gateway', ok: false, avgLatency24h: null, uptime24h: null }],
        },
      }),
    );

    const gateway = gatewaySidecar(container);
    expect(gateway?.textContent).toContain('采集异常');
    expect(gateway?.textContent).toContain('—');
    expect(gateway?.textContent).not.toMatch(/\d+\s*ms/);
    expect(hop(container, 'Caddy').textContent).toContain('未采集');
  });

  it('没有 gateway 采集目标：Caddy 不写死任何毫秒字面量，也不渲染网关标注', () => {
    const container = renderWith(
      readySnapshot({
        status: {
          overall: 'operational',
          services: [{ key: 'site', ok: true, avgLatency24h: 128, uptime24h: 99.9 }],
        },
        pingMs: 25,
      }),
    );

    const caddy = hop(container, 'Caddy');
    expect(caddy.textContent).toContain('未采集');
    expect(caddy.textContent).not.toMatch(/\d+\s*ms/);
    expect(gatewaySidecar(container)).toBeNull();
  });
});

describe('RequestPath · safeline 各状态', () => {
  it('ok：展示采集中与真实拦截数', () => {
    const container = renderWith(readySnapshot({ safelineState: 'ok', blocked24h: 128 }));

    const row = hop(container, '雷池 SafeLine');
    expect(row.textContent).toContain('采集中');
    expect(row.textContent).toContain('128');
  });

  it('stale：展示数据过期，绝不展示过期拦截数', () => {
    const container = renderWith(readySnapshot({ safelineState: 'stale', blocked24h: null }));

    const row = hop(container, '雷池 SafeLine');
    expect(row.textContent).toContain('数据过期');
    expect(row.textContent).toContain('24h 拦截');
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toMatch(/\d+\s*(?:次|条)/);
  });

  it('unavailable：展示未接入与占位符', () => {
    const container = renderWith(readySnapshot({ safelineState: 'unavailable', blocked24h: null }));

    const row = hop(container, '雷池 SafeLine');
    expect(row.textContent).toContain('未接入');
    expect(row.textContent).toContain('—');
  });

  it('protection 请求失败：状态与拦截数都回落为占位符', () => {
    const container = renderWith(
      readySnapshot({ protectionPhase: 'failed', safelineState: null, blocked24h: null }),
    );

    const row = hop(container, '雷池 SafeLine');
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toContain('采集中');
  });
});

describe('RequestPath · 单来源失败不牵连其它来源', () => {
  it('只有 ping 失败：边缘用占位符，但 overall 仍可显示运行正常', () => {
    const container = renderWith(
      readySnapshot({
        pingPhase: 'failed',
        pingMs: null,
        status: {
          overall: 'operational',
          services: [{ key: 'site', ok: true, avgLatency24h: 120, uptime24h: 99.9 }],
        },
      }),
    );

    expect(hop(container, 'ESA 边缘').textContent).toContain('—');
    expect(container.textContent).toContain('运行正常');
  });

  it('只有 status 失败：Caddy/SSR/PB 都回落，防御统计仍然展示', () => {
    const container = renderWith(
      readySnapshot({
        statusPhase: 'failed',
        status: null,
        safelineState: 'ok',
        blocked24h: 9,
        pingMs: 30,
      }),
    );

    expect(container.textContent).toContain('检测中');
    expect(hop(container, 'ESA 边缘').textContent).toContain('30 ms');
    // status 失败 → Caddy 行必须表达「失败」，不能混同于「未采集」这个正常读取结果。
    expect(hop(container, 'Caddy').textContent).toContain('采集失败');
    expect(hop(container, 'Caddy').textContent).not.toContain('未采集');
    expect(hop(container, 'Astro SSR').textContent).toContain('—');
    expect(hop(container, 'PocketBase').textContent).toContain('—');
    expect(gatewaySidecar(container)).toBeNull();
  });
});

describe('RequestPath · 结构与可达性', () => {
  it('保留 5 个有序链路的列表语义与真实节点名称', () => {
    store.snapshot = readySnapshot();
    const { container } = render(<RequestPath />);

    const list = screen.getByRole('list', { name: '真实请求链路' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(container.textContent).toContain('ESA 边缘');
    expect(container.textContent).toContain('雷池 SafeLine');
    expect(container.textContent).toContain('Caddy');
    expect(container.textContent).toContain('Astro SSR');
    expect(container.textContent).toContain('PocketBase');
    // 序号只是结构标注，不是伪造的遥测值。
    for (const index of ['01', '02', '03', '04', '05']) {
      expect(container.textContent).toContain(index);
    }
  });
});
