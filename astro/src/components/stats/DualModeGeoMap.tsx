import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { echarts, registerWorldMap, registerChinaMap, type EChartsInstance } from '../../lib/echarts-map';
import { ADCODE_TO_PROVINCE } from '../../lib/geoConstants';
import { playMapTransition } from '../../lib/map-particles';
import type { EChartsOption } from 'echarts';

/**
 * 双模式访客地理分布地图
 * - 国际模式：世界地图，按国家着色
 * - 国内模式：中国地图，按省份着色（符合自然资源部标准，含南海诸岛）
 *
 * 技术：ECharts 地图渲染 + D3 辅助动画过渡
 */

interface GeoData {
  views: number;
  uv: number;
  name: string;
}

interface DualModeGeoMapProps {
  /** 国际数据：ISO numeric code → GeoData */
  worldData: Record<string, GeoData>;
  /** 中国数据：adcode → GeoData */
  chinaData: Record<string, GeoData>;
  /** 最大浏览量（用于颜色归一化） */
  maxViews: number;
}

type MapMode = 'world' | 'china';

// 颜色梯度（与现有 GeoMap 保持一致）
const COLOR_RANGE = ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488'];

function DualModeGeoMap({ worldData, chinaData, maxViews }: DualModeGeoMapProps) {
  const [mode, setMode] = useState<MapMode>('world');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<EChartsInstance | null>(null);

  // 初始化：注册地图数据
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await Promise.all([registerWorldMap(), registerChinaMap()]);
        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        console.error('Map registration failed:', err);
        if (!cancelled) {
          setError('地图数据加载失败，请刷新重试');
          setLoading(false);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // 初始化 ECharts 实例
  useEffect(() => {
    if (loading || error || !chartRef.current) return;

    const instance = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
      useDirtyRect: true, // 性能优化：脏矩形渲染
    });
    chartInstance.current = instance;

    // 响应式：监听容器尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      chartInstance.current = null;
    };
  }, [loading, error]);

  // 构建 ECharts 配置
  const buildOption = useCallback((): EChartsOption => {
    const isWorld = mode === 'world';
    const dataSource = isWorld ? worldData : chinaData;

    // 转换为 ECharts 数据格式
    const seriesData = Object.entries(dataSource).map(([id, data]) => ({
      name: isWorld
        ? data.name  // 世界地图用 name 匹配（ECharts 按 GeoJSON properties.name 匹配）
        : (ADCODE_TO_PROVINCE[Number(id)] || data.name),
      value: data.views,
      uv: data.uv,
      regionId: id,
    }));

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: '#e4e4e7',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#18181b', fontSize: 13 },
        formatter: (params: any) => {
          const { name, value, data: itemData } = params;
          const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c: string) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
          if (!value) return `<b>${esc(name)}</b><br/>暂无数据`;
          const uv = itemData?.uv ?? '-';
          return `<b>${esc(name)}</b><br/>浏览量：${esc(value)}<br/>独立访客：${esc(uv)}`;
        },
      },
      visualMap: {
        type: 'continuous',
        min: 0,
        max: Math.max(maxViews, 1),
        inRange: { color: COLOR_RANGE },
        outOfRange: { color: '#e4e4e7' },
        text: ['高', '低'],
        textStyle: { color: '#71717a', fontSize: 11 },
        left: 16,
        bottom: 16,
        itemWidth: 12,
        itemHeight: 80,
        calculable: true,
      },
      geo: {
        map: isWorld ? 'world' : 'china',
        roam: true, // 启用缩放和平移
        zoom: isWorld ? 1.2 : 1.0,
        center: isWorld ? undefined : [104.5, 36.5], // 中国地图中心（含南海）
        scaleLimit: { min: 0.8, max: 8 },
        label: {
          show: !isWorld, // 中国地图显示省份标签
          fontSize: 9,
          color: '#52525b',
        },
        itemStyle: {
          areaColor: '#f4f4f5',
          borderColor: '#d4d4d8',
          borderWidth: 0.5,
        },
        emphasis: {
          itemStyle: {
            areaColor: '#99f6e4',
            borderColor: '#0d9488',
            borderWidth: 1.5,
          },
          label: { show: true, color: '#134e4a', fontWeight: 'bold' },
        },
        // 南海诸岛样式（确保合规显示）
        regions: isWorld ? [] : [
          {
            name: '',  // 100000_JD 要素的 name 为空
            itemStyle: { areaColor: '#f4f4f5', borderColor: '#a1a1aa' },
            label: { show: false },
          },
        ],
      },
      series: [
        {
          type: 'map',
          map: isWorld ? 'world' : 'china',
          geoIndex: 0, // 复用 geo 组件
          data: seriesData,
        },
      ],
      // 动画配置
      animationDurationUpdate: 600,
      animationEasingUpdate: 'cubicInOut',
    };
  }, [mode, worldData, chinaData, maxViews]);

  // 更新图表（仅在模式切换时 notMerge，数据更新时保留用户缩放/平移）
  const prevMode = useRef(mode);
  useEffect(() => {
    if (!chartInstance.current || loading || error) return;
    const isModeChange = prevMode.current !== mode;
    prevMode.current = mode;
    const option = buildOption();
    chartInstance.current.setOption(option, { notMerge: isModeChange });
  }, [buildOption, loading, error, mode]);

  // 模式切换（粒子破碎→聚合过渡动画）
  const [transitioning, setTransitioning] = useState(false);
  const transitionRef = useRef<{ destroy: () => void } | null>(null);

  // 组件卸载时中断动画
  useEffect(() => {
    return () => {
      transitionRef.current?.destroy();
      transitionRef.current = null;
    };
  }, []);

  const handleModeSwitch = useCallback(async (newMode: MapMode) => {
    if (newMode === mode || !chartInstance.current || transitioning) return;

    const containerEl = chartRef.current;
    if (!containerEl) {
      setMode(newMode);
      return;
    }

    // 找到 ECharts 渲染的 Canvas 元素
    const sourceCanvas = containerEl.querySelector('canvas');
    if (!sourceCanvas) {
      setMode(newMode);
      return;
    }

    setTransitioning(true);

    // 隐藏 ECharts 地图，让粒子层完全覆盖（避免边界线透出）
    containerEl.style.opacity = '0';
    containerEl.style.transition = 'none';

    try {
      const handle = playMapTransition(sourceCanvas, containerEl, () => {
        // 在过渡阶段切换 ECharts 地图
        setMode(newMode);
      }, {
        onGatherNearComplete: () => {
          // 聚合阶段 70% 时淡入新地图
          containerEl.style.transition = 'opacity 0.3s ease-in';
          containerEl.style.opacity = '1';
        },
      });
      transitionRef.current = handle;
      await handle.promise;
    } catch {
      // 动画失败时直接切换
      setMode(newMode);
    } finally {
      transitionRef.current = null;
      // 恢复 ECharts 地图可见性（如果回调未触发）
      containerEl.style.opacity = '1';
      containerEl.style.transition = '';
      setTransitioning(false);
    }
  }, [mode, transitioning]);

  // 加载状态
  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center" role="status" aria-label="地图加载中">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        <span className="ml-3 text-sm text-zinc-500">地图数据加载中…</span>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-3" role="alert">
        <span className="text-sm text-zinc-500">{error}</span>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white hover:bg-teal-700"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 模式切换按钮 */}
      <div className="mb-4 flex gap-2" role="tablist" aria-label="地图模式切换">
        <button
          role="tab"
          aria-selected={mode === 'world'}
          onClick={() => handleModeSwitch('world')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'world'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          🌍 国际地图
        </button>
        <button
          role="tab"
          aria-selected={mode === 'china'}
          onClick={() => handleModeSwitch('china')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'china'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
        >
          🇨🇳 中国地图
        </button>
      </div>

      {/* ECharts 容器 */}
      <div
        className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
        style={{ background: 'var(--color-zinc-50, #fafafa)' }}
      >
        <div
          ref={chartRef}
          className="h-[420px] w-full"
          role="img"
          aria-label={mode === 'china' ? '中国访客地理分布地图' : '国际访客地理分布地图'}
        />
      </div>

      {/* 中国地图合规声明 */}
      {mode === 'china' && (
        <p className="mt-2 text-center text-[10px] text-zinc-400">
          地图数据来源：DataV.GeoAtlas | 含南海诸岛、钓鱼岛及赤尾屿 | 审图号：GS(2024)0650号
        </p>
      )}
    </div>
  );
}

export default memo(DualModeGeoMap);
