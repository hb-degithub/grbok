import React, { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { echarts, registerWorldMap, registerChinaMap, type EChartsInstance } from '../../lib/echarts-map';
import { ADCODE_TO_PROVINCE } from '../../lib/geoConstants';
import { playMapTransition } from '../../lib/map-particles';
import type { EChartsOption } from 'echarts';

// 懒加载 3D 地球组件（Three.js ~600KB，避免阻塞首屏）
const Globe3D = lazy(() => import('./Globe3D'));

/**
 * 双模式访客地理分布地图
 * - 2D 模式：ECharts 平面地图（世界/中国）
 * - 3D 模式：Three.js 粒子地球（世界/中国）
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
  /** 中国数据：adcode → GeoData */
  chinaData: Record<string, GeoData>;
  /** 最大浏览量（用于颜色归一化） */
  maxViews: number;
}

type MapMode = 'world' | 'china';
type RenderMode = '2d' | '3d';

// 颜色梯度（与现有 GeoMap 保持一致）
const COLOR_RANGE = ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488'];

// 省份简称到全称的映射（用于匹配 DataV.GeoAtlas 的 properties.name）
const PROVINCE_SHORT_TO_FULL: Record<string, string> = {
  '北京': '北京市', '天津': '天津市', '上海': '上海市', '重庆': '重庆市',
  '河北': '河北省', '山西': '山西省', '辽宁': '辽宁省', '吉林': '吉林省',
  '黑龙江': '黑龙江省', '江苏': '江苏省', '浙江': '浙江省', '安徽': '安徽省',
  '福建': '福建省', '江西': '江西省', '山东': '山东省', '河南': '河南省',
  '湖北': '湖北省', '湖南': '湖南省', '广东': '广东省', '海南': '海南省',
  '四川': '四川省', '贵州': '贵州省', '云南': '云南省', '陕西': '陕西省',
  '甘肃': '甘肃省', '青海': '青海省', '台湾': '台湾省',
  '内蒙古': '内蒙古自治区', '广西': '广西壮族自治区', '西藏': '西藏自治区',
  '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区',
  '香港': '香港特别行政区', '澳门': '澳门特别行政区',
};

function DualModeGeoMap({ worldData, chinaData, maxViews }: DualModeGeoMapProps) {
  const [mode, setMode] = useState<MapMode>('world');
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
  }, [renderMode]);

  // 初始化 ECharts 实例（仅 2D 模式）
  useEffect(() => {
    if (renderMode !== '2d' || loading || error || !chartRef.current) return;

    const instance = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
      useDirtyRect: true,
    });
    chartInstance.current = instance;

    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      chartInstance.current = null;
    };
  }, [loading, error, renderMode]);

  // 构建 ECharts 配置
  const buildOption = useCallback((): EChartsOption => {
    const isWorld = mode === 'world';
    const dataSource = isWorld ? worldData : chinaData;

    const seriesData = Object.entries(dataSource).map(([id, data]) => {
      let name: string;
      if (isWorld) {
        name = data.name;
      } else {
        // 中国地图：ADCODE_TO_PROVINCE 返回简称（如"广东"），需转为全称（如"广东省"）匹配 GeoJSON
        const shortName = ADCODE_TO_PROVINCE[Number(id)] || data.name;
        name = PROVINCE_SHORT_TO_FULL[shortName] || shortName;
      }
      return {
        name,
        value: data.views,
        uv: data.uv,
        regionId: id,
      };
    });

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
        roam: true,
        zoom: isWorld ? 1.2 : 1.0,
        center: isWorld ? undefined : [104.5, 36.5],
        scaleLimit: { min: 0.8, max: 8 },
        label: {
          show: !isWorld,
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
        regions: isWorld ? [] : [
          {
            name: '',
            itemStyle: { areaColor: '#f4f4f5', borderColor: '#a1a1aa' },
            label: { show: false },
          },
        ],
      },
      series: [
        {
          type: 'map',
          map: isWorld ? 'world' : 'china',
          geoIndex: 0,
          data: seriesData,
        },
      ],
      animationDurationUpdate: 600,
      animationEasingUpdate: 'cubicInOut',
    };
  }, [mode, worldData, chinaData, maxViews]);

  // 更新图表（仅在模式切换时 notMerge，数据更新时保留用户缩放/平移）
  const prevMode = useRef(mode);
  useEffect(() => {
    if (renderMode !== '2d' || !chartInstance.current || loading || error) return;
    const isModeChange = prevMode.current !== mode;
    prevMode.current = mode;
    const option = buildOption();
    chartInstance.current.setOption(option, { notMerge: isModeChange });
  }, [buildOption, loading, error, mode, renderMode]);

  // 模式切换（粒子破碎→聚合过渡动画）
  const [transitioning, setTransitioning] = useState(false);
  const transitionRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    return () => {
      transitionRef.current?.destroy();
      transitionRef.current = null;
    };
  }, []);

  const handleModeSwitch = useCallback(async (newMode: MapMode) => {
    if (newMode === mode || transitioning) return;

    // 3D 模式下直接切换，无需粒子动画
    if (renderMode === '3d') {
      setMode(newMode);
      return;
    }

    // 2D 模式使用粒子过渡动画
    if (!chartInstance.current) {
      setMode(newMode);
      return;
    }

    const containerEl = chartRef.current;
    if (!containerEl) {
      setMode(newMode);
      return;
    }

    const sourceCanvas = containerEl.querySelector('canvas');
    if (!sourceCanvas) {
      setMode(newMode);
      return;
    }

    setTransitioning(true);
    containerEl.style.opacity = '0';
    containerEl.style.transition = 'none';

    try {
      const handle = playMapTransition(sourceCanvas, containerEl, () => {
        setMode(newMode);
      }, {
        onGatherNearComplete: () => {
          containerEl.style.transition = 'opacity 0.3s ease-in';
          containerEl.style.opacity = '1';
        },
      });
      transitionRef.current = handle;
      await handle.promise;
    } catch {
      setMode(newMode);
    } finally {
      transitionRef.current = null;
      containerEl.style.opacity = '1';
      containerEl.style.transition = '';
      setTransitioning(false);
    }
  }, [mode, transitioning, renderMode]);

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
    <div className="relative">
      {/* 切换按钮组 */}
      <div className="mb-4 flex flex-wrap items-center gap-3" role="tablist" aria-label="地图模式切换">
        {/* 2D/3D 切换 */}
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="渲染模式">
          <button
            role="tab"
            aria-selected={renderMode === '3d'}
            onClick={() => handleRenderModeSwitch('3d')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              renderMode === '2d'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            2D
          </button>
        </div>

        {/* 分隔线 */}
        <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

        {/* 世界/中国切换 */}
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="地图区域">
          <button
            role="tab"
            aria-selected={mode === 'world'}
            onClick={() => handleModeSwitch('world')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'world'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            世界
          </button>
          <button
            role="tab"
            aria-selected={mode === 'china'}
            onClick={() => handleModeSwitch('china')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'china'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            中国
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
            chinaData={chinaData}
            maxViews={maxViews}
            mode={mode}
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
              aria-label={mode === 'china' ? '中国访客地理分布地图' : '国际访客地理分布地图'}
            />
          </div>

          {/* 中国地图合规声明 */}
          {mode === 'china' && (
            <p className="mt-2 text-center text-[10px] text-zinc-400">
              地图数据来源：DataV.GeoAtlas | 含南海诸岛、钓鱼岛及赤尾屿 | 审图号：GS(2024)0650号
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default memo(DualModeGeoMap);
