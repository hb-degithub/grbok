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
  default: () => <div data-testid="globe-3d">3D Globe</div>,
}));

// Mock ResizeObserver
class MockResizeObserver {
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

const mockChinaData = {
  '110000': { views: 300, uv: 200, name: '北京' },
  '440000': { views: 500, uv: 350, name: '广东' },
};

describe('DualModeGeoMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认 3D 模式下渲染 3D 地球', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    // 默认 3D 模式，应显示 3D 加载状态或 3D 组件
    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 应有 4 个切换按钮（3D/2D + 世界/中国）
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0].textContent).toBe('3D');
    expect(tabs[1].textContent).toBe('2D');
    expect(tabs[2].textContent).toBe('世界');
    expect(tabs[3].textContent).toBe('中国');

    // 3D 按钮应为激活状态
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('包含 2D/3D 和世界/中国切换按钮', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(4);
      expect(tabs[0].textContent).toBe('3D');
      expect(tabs[1].textContent).toBe('2D');
      expect(tabs[2].textContent).toBe('世界');
      expect(tabs[3].textContent).toBe('中国');
    });
  });

  it('切换到 2D 模式后加载 ECharts 地图', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
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
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
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

  it('2D 中国模式下显示合规声明', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 切换到 2D 模式
    fireEvent.click(screen.getAllByRole('tab')[1]);

    // 等待 ECharts 初始化
    await waitFor(() => {
      expect(echarts.init).toHaveBeenCalled();
    });

    // 切换到中国地图
    fireEvent.click(screen.getAllByRole('tab')[3]); // 点击"中国"按钮

    await waitFor(() => {
      expect(screen.getByText(/南海诸岛/)).toBeTruthy();
    });
  });
});
