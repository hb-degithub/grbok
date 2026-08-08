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

  it('显示加载状态后渲染地图', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    // 初始应显示加载状态
    expect(screen.getByRole('status')).toBeTruthy();

    // 加载完成后应显示切换按钮
    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });
  });

  it('包含国际/国内两个切换按钮', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[0].textContent).toContain('国际地图');
      expect(tabs[1].textContent).toContain('中国地图');
    });
  });

  it('地图加载失败时显示错误信息和重试按钮', async () => {
    const { registerWorldMap } = await import('../../lib/echarts-map');
    (registerWorldMap as any).mockRejectedValueOnce(new Error('Network error'));

    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('重新加载')).toBeTruthy();
    });
  });

  it('中国模式下显示合规声明', async () => {
    render(
      <DualModeGeoMap worldData={mockWorldData} chinaData={mockChinaData} maxViews={1200} />
    );

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeTruthy();
    });

    // 等待图表实例创建完成（chartInstance 就绪后模式切换才生效）
    await waitFor(() => {
      expect(echarts.init).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole('tab')[1]); // 切换到中国地图

    await waitFor(() => {
      expect(screen.getByText(/南海诸岛/)).toBeTruthy();
    });
  });
});
