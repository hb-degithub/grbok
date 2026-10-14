import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock ECharts
vi.mock('../../lib/echarts-map', () => ({
  echarts: {
    init: vi.fn(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
    registerMap: vi.fn(),
  },
  registerWorldMap: vi.fn().mockResolvedValue(undefined),
  registerChinaMap: vi.fn().mockResolvedValue(undefined),
}));

// Mock Globe3D 组件（避免 Three.js 在测试环境中加载）
vi.mock('./Globe3D', () => ({
  default: () => React.createElement('div', { 'data-testid': 'globe-3d' }, '3D Globe'),
}));

// Mock ResizeObserver
const resizeCallbacks: ResizeObserverCallback[] = [];
class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

import DualModeGeoMap from './DualModeGeoMap';
import { echarts } from '../../lib/echarts-map';

const mockWorldData = {
  '156': { views: 1200, uv: 800, name: 'China' },
  '840': { views: 500, uv: 300, name: 'United States' },
};

describe('DualModeGeoMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resizeCallbacks.length = 0;
  });

  it('does not resize the 2D chart after its container loses its layout during a mode switch', async () => {
    render(<DualModeGeoMap worldData={mockWorldData} />);
    fireEvent.click(await screen.findByRole('tab', { name: '2D' }));
    await waitFor(() => expect(echarts.init).toHaveBeenCalled());
    const instance = vi.mocked(echarts.init).mock.results.at(-1)!.value;
    const map = screen.getByRole('img', { name: '国际访客地理分布地图' });
    Object.defineProperty(map, 'clientWidth', { value: 0, configurable: true });
    Object.defineProperty(map, 'clientHeight', { value: 0, configurable: true });
    resizeCallbacks.at(-1)!([], {} as ResizeObserver);
    expect(instance.resize).not.toHaveBeenCalled();
  });

  it('默认 3D 模式下渲染 3D 地球', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} />
    );

    // 默认 3D 模式，应显示 3D 加载状态或 3D 组件
    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 仅保留 3D/2D 两种世界地图视图
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe('3D');
    expect(tabs[1].textContent).toBe('2D');

    // 3D 按钮应为激活状态
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('只提供 2D/3D 切换，不再提供中国省份视图', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} />
    );

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[0].textContent).toBe('3D');
      expect(tabs[1].textContent).toBe('2D');
    });
  });

  it('切换到 2D 模式后加载 ECharts 地图', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} />
    );

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 切换到 2D 模式
    fireEvent.click(screen.getAllByRole('tab')[1]); // 点击 2D 按钮

    // 2D 模式下应显示加载状态
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });

    // 加载完成后应显示 ECharts 容器
    await waitFor(() => {
      expect(echarts.init).toHaveBeenCalled();
    });
  });

  it('2D 模式地图加载失败时显示错误信息和重试按钮', async () => {
    const { registerWorldMap } = await import('../../lib/echarts-map');
    (registerWorldMap as any).mockRejectedValueOnce(new Error('Network error'));

    render(
      <DualModeGeoMap worldData={mockWorldData} />
    );

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 切换到 2D 模式
    fireEvent.click(screen.getAllByRole('tab')[1]);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('重新加载')).toBeTruthy();
    });
  });

  it('2D 仅加载世界地图，仍保留中国的国家级访问数据', async () => {
    const { registerWorldMap, registerChinaMap } = await import('../../lib/echarts-map');
    render(<DualModeGeoMap worldData={mockWorldData} />);
    fireEvent.click(await screen.findByRole('tab', { name: '2D' }));
    await waitFor(() => expect(echarts.init).toHaveBeenCalled());
    expect(registerWorldMap).toHaveBeenCalled();
    expect(registerChinaMap).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: '中国' })).toBeNull();
    const option = vi.mocked(echarts.init).mock.results.at(-1)!.value.setOption.mock.calls.at(-1)[0];
    expect(option.geo.map).toBe('world');
    expect(option.series[0].data).toContainEqual({ name: 'China', value: 1200, uv: 800, regionId: '156' });
  });
});
