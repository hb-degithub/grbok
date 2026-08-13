import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Globe3DEngine, type GlobeGeoData } from '../../lib/globe-3d';

/**
 * 3D 粒子地球 React 组件
 * 封装 Three.js 渲染生命周期，支持世界/中国模式
 */

interface Globe3DProps {
  /** 国际数据：ISO numeric code → GeoData */
  worldData: Record<string, GlobeGeoData>;
  /** 中国数据：adcode → GeoData */
  chinaData: Record<string, GlobeGeoData>;
  /** 最大浏览量（用于颜色归一化） */
  maxViews: number;
  /** 地图模式 */
  mode: 'world' | 'china';
  /** WebGL 不可用时回退到 2D 的回调 */
  onFallback?: () => void;
}

interface TooltipState {
  visible: boolean;
  name: string;
  views: number;
  uv: number;
  x: number;
  y: number;
}

function Globe3D({ worldData, chinaData, maxViews, mode, onFallback }: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Globe3DEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    name: '',
    views: 0,
    uv: 0,
    x: 0,
    y: 0,
  });

  // 悬停回调
  const handleHover = useCallback(
    (data: { name: string; views: number; uv: number } | null, x: number, y: number) => {
      if (data) {
        setTooltip({
          visible: true,
          name: data.name,
          views: data.views,
          uv: data.uv,
          x,
          y,
        });
      } else {
        setTooltip((prev) => ({ ...prev, visible: false }));
      }
    },
    []
  );

  // 初始化引擎
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    const engine = new Globe3DEngine({
      container: containerRef.current,
      worldData,
      chinaData,
      maxViews,
      mode,
      onHover: handleHover,
    });

    engineRef.current = engine;

    engine
      .init()
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((err) => {
        console.error('Globe3D init failed:', err);
        if (!cancelled) {
          // WebGL 不可用时自动回退到 2D 模式
          if (err instanceof Error && err.message === 'WebGL not supported') {
            onFallback?.();
            return;
          }
          setError('3D 地球加载失败');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
    };
    // 仅在挂载时初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据/模式更新
  useEffect(() => {
    if (!engineRef.current || loading) return;
    engineRef.current.updateData(worldData, chinaData, maxViews, mode);
  }, [worldData, chinaData, maxViews, mode, loading]);

  // 错误状态
  if (error) {
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
      {/* Three.js 容器 — 始终渲染，确保 ref 可用 */}
      <div
        ref={containerRef}
        className="h-[480px] w-full overflow-hidden rounded-lg"
        role="img"
        aria-label={mode === 'china' ? '中国访客 3D 地球' : '国际访客 3D 地球'}
      />

      {/* 加载覆盖层 */}
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 dark:bg-zinc-900/80"
          role="status"
          aria-label="3D 地球加载中"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          <span className="ml-3 text-sm text-zinc-500">3D 地球加载中…</span>
        </div>
      )}

      {/* 悬停 Tooltip */}
      {tooltip.visible && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{
            left: `${(tooltip.x + 1) * 50}%`,
            top: `${(-tooltip.y + 1) * 50}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{tooltip.name}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            浏览量：{tooltip.views} · 独立访客：{tooltip.uv}
          </div>
        </div>
      )}

      {/* 操作提示 */}
      <div className="mt-2 text-center text-[10px] text-zinc-400">
        拖拽旋转 · 自动自转
      </div>
    </div>
  );
}

export default memo(Globe3D);
