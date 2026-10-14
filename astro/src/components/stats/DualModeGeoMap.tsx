import React, { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { echarts, registerWorldMap, type EChartsInstance } from '../../lib/echarts-map';
import { playMapTransition } from '../../lib/map-particles';
import type { EChartsOption } from 'echarts';
import { viewMaximum } from '../../lib/globe-geo';

// 懒加载 3D 地球组件（Three.js ~600KB，避免阻塞首屏）
const Globe3D = lazy(() => import('./Globe3D'));

/**
 * 双模式访客地理分布地图
 * - 2D 模式：ECharts 平面地图（世界）
 * - 3D 模式：Three.js 粒子地球（世界）
 *
 * 技术：ECharts 地图渲染 + Three.js 粒子地球 + D3 辅助动画过渡
 */

interface GeoData {
  views: number;
  uv: number;
  name: string;
}

interface DualModeGeoMapProps {
  /** 国际数据：ISO numeric code → GeoData */
  worldData: Record<string, GeoData>;
}

type RenderMode = '2d' | '3d';

// 颜色梯度（与现有 GeoMap 保持一致）
const COLOR_RANGE = ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488'];

function DualModeGeoMap({ worldData }: DualModeGeoMapProps) {
  const [renderMode, setRenderMode] = useState<RenderMode>('3d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<EChartsInstance | null>(null);

  // 初始化：注册地图数据（仅 2D 模式需要）
  useEffect(() => {
    if (renderMode !== '2d') {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        await registerWorldMap();
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
  }, [renderMode]);

  // 初始化 ECharts 实例（仅 2D 模式）
  useEffect(() => {
    if (renderMode !== '2d' || loading || error || !chartRef.current) return;

    const container = chartRef.current;
    const instance = echarts.init(container, undefined, {
      renderer: 'canvas',
      useDirtyRect: true,
    });
    chartInstance.current = instance;

    let disposed = false;
    const resizeObserver = new ResizeObserver(() => {
      // Mode transitions can enqueue one last observer delivery after layout is gone.
      // ECharts cannot invert a zero-sized geographic transform.
      if (disposed || !container.isConnected || container.clientWidth <= 0 || container.clientHeight <= 0) return;
      instance.resize();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      instance.dispose();
      chartInstance.current = null;
    };
  }, [loading, error, renderMode]);

  // 构建 ECharts 配置
  const buildOption = useCallback((): EChartsOption => {
    const seriesData = Object.entries(worldData).map(([id, data]) => ({
      name: data.name,
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
        max: viewMaximum(worldData),
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
        map: 'world',
        roam: true,
        zoom: 1.2,
        scaleLimit: { min: 0.8, max: 8 },
        label: {
          show: false,
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
      },
      series: [
        {
          type: 'map',
          map: 'world',
          geoIndex: 0,
          data: seriesData,
        },
      ],
      animationDurationUpdate: 600,
      animationEasingUpdate: 'cubicInOut',
    };
  }, [worldData]);

  // 数据更新时保留用户缩放/平移
  useEffect(() => {
    if (renderMode !== '2d' || !chartInstance.current || loading || error) return;
    const option = buildOption();
    chartInstance.current.setOption(option, { notMerge: false });
  }, [buildOption, loading, error, renderMode]);

  // 模式切换（粒子破碎→聚合过渡动画）
  const [transitioning, setTransitioning] = useState(false);
  const transitionRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    return () => {
      transitionRef.current?.destroy();
      transitionRef.current = null;
    };
  }, []);

  // 渲染模式切换（带粒子过渡动画）
  const handleRenderModeSwitch = useCallback(async (newRenderMode: RenderMode) => {
    if (newRenderMode === renderMode || transitioning) return;

    // 找到当前渲染的容器元素用于粒子采样
    const currentContainer = chartRef.current?.closest('.relative') as HTMLElement;
    const sourceCanvas = currentContainer?.querySelector('canvas');

    if (sourceCanvas && currentContainer) {
      // 有 Canvas 可采样，使用粒子过渡动画
      setTransitioning(true);
      currentContainer.style.opacity = '0';
      currentContainer.style.transition = 'none';

      try {
        const handle = playMapTransition(sourceCanvas, currentContainer, () => {
          setRenderMode(newRenderMode);
          if (newRenderMode === '2d') {
            setLoading(true);
            setError(null);
          }
        }, {
          onGatherNearComplete: () => {
            currentContainer.style.transition = 'opacity 0.3s ease-in';
            currentContainer.style.opacity = '1';
          },
        });
        transitionRef.current = handle;
        await handle.promise;
      } catch {
        setRenderMode(newRenderMode);
        if (newRenderMode === '2d') {
          setLoading(true);
          setError(null);
        }
      } finally {
        transitionRef.current = null;
        currentContainer.style.opacity = '1';
        currentContainer.style.transition = '';
        setTransitioning(false);
      }
    } else {
      // 无 Canvas 可采样，直接切换
      setRenderMode(newRenderMode);
      if (newRenderMode === '2d') {
        setLoading(true);
        setError(null);
      }
    }
  }, [renderMode, transitioning]);

  // WebGL 不可用时回退到 2D
  const handleWebGLFallback = useCallback(() => {
    setRenderMode('2d');
    setLoading(true);
    setError(null);
  }, []);

  // 加载状态（仅 2D 模式）
  if (renderMode === '2d' && loading) {
    return (
      <div className="flex h-[480px] items-center justify-center" role="status" aria-label="地图加载中">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        <span className="ml-3 text-sm text-zinc-500">地图数据加载中…</span>
      </div>
    );
  }

  // 错误状态（仅 2D 模式）
  if (renderMode === '2d' && error) {
    return (
      <div className="flex h-[480px] flex-col items-center justify-center gap-3" role="alert">
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
    <div className="relative min-w-0">
      {/* 切换按钮组 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3" role="tablist" aria-label="地图模式切换">
        {/* 2D/3D 切换 */}
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="渲染模式">
          <button
            role="tab"
            aria-selected={renderMode === '3d'}
            onClick={() => handleRenderModeSwitch('3d')}
            className={`min-h-11 min-w-11 rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${
              renderMode === '3d'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            3D
          </button>
          <button
            role="tab"
            aria-selected={renderMode === '2d'}
            onClick={() => handleRenderModeSwitch('2d')}
            className={`min-h-11 min-w-11 rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${
              renderMode === '2d'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            2D
          </button>
        </div>

      </div>

      {/* 3D 模式 */}
      {renderMode === '3d' && (
        <Suspense
          fallback={
            <div className="flex h-[480px] items-center justify-center" role="status" aria-label="3D 地球加载中">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
              <span className="ml-3 text-sm text-zinc-500">3D 地球加载中…</span>
            </div>
          }
        >
          <Globe3D
            worldData={worldData}
            onFallback={handleWebGLFallback}
          />
        </Suspense>
      )}

      {/* 2D 模式 */}
      {renderMode === '2d' && (
        <>
          <div
            className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
            style={{ background: 'var(--color-zinc-50, #fafafa)' }}
          >
            <div
              ref={chartRef}
              className="h-[480px] w-full"
              role="img"
              aria-label="国际访客地理分布地图"
            />
          </div>

        </>
      )}
    </div>
  );
}

export default memo(DualModeGeoMap);
