import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon, GeoJsonProperties } from 'geojson';
import { geoPath, geoMercator, geoEquirectangular } from 'd3-geo';
import { ADCODE_TO_PROVINCE } from '../../lib/geoConstants';

/**
 * 访客地理分布地图组件
 * 支持中国/国际地图切换，悬停高亮显示详情
 */

interface GeoData {
  views: number;
  uv: number;
  name: string;
}

interface RegionFeature extends Omit<Feature<MultiPolygon | Polygon, GeoJsonProperties>, 'properties'> {
  id?: string;
  properties?: {
    name?: string;
    adcode?: number;
    [key: string]: unknown;
  };
}

interface GeoMapProps {
  // 国际数据：ISO numeric -> GeoData
  worldData: Record<string, GeoData>;
  // 中国数据：adcode -> GeoData
  chinaData: Record<string, GeoData>;
  maxViews: number;
}

type MapMode = 'world' | 'china';

// 模块级缓存，避免重复加载
let cachedWorldGeos: RegionFeature[] | null = null;
let cachedChinaGeos: RegionFeature[] | null = null;

function GeoMap({ worldData, chinaData, maxViews }: GeoMapProps) {
  const [mode, setMode] = useState<MapMode>('world');
  const [worldGeos, setWorldGeos] = useState<RegionFeature[]>(cachedWorldGeos || []);
  const [chinaGeos, setChinaGeos] = useState<RegionFeature[]>(cachedChinaGeos || []);
  const [loading, setLoading] = useState(!cachedWorldGeos || !cachedChinaGeos);
  const [error, setError] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<{ id: string; name: string; data?: GeoData; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 地图尺寸常量
  const width = mode === 'china' ? 800 : 800;
  const height = mode === 'china' ? 500 : 420;

  // 加载地图数据（仅当缓存为空时）
  useEffect(() => {
    if (cachedWorldGeos && cachedChinaGeos) {
      setWorldGeos(cachedWorldGeos);
      setChinaGeos(cachedChinaGeos);
      setLoading(false);
      return;
    }

    Promise.all([
      fetch('/countries-110m.json').then((res) => {
        if (!res.ok) throw new Error('Failed to load world map');
        return res.json();
      }),
      fetch('/china-provinces.json').then((res) => {
        if (!res.ok) throw new Error('Failed to load china map');
        return res.json();
      }),
    ])
      .then(([worldTopology, chinaGeoJson]) => {
        // 世界地图（TopoJSON）
        const countries = worldTopology.objects.countries as GeometryCollection;
        const worldFeatures = feature(worldTopology, countries) as unknown as { features: RegionFeature[] };
        cachedWorldGeos = worldFeatures.features;
        setWorldGeos(cachedWorldGeos);

        // 中国地图（GeoJSON）
        cachedChinaGeos = chinaGeoJson.features || [];
        setChinaGeos(cachedChinaGeos || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Map data load error:', err);
        setError(true);
        setLoading(false);
      });
  }, []);

  // 使用 d3-geo 创建投影
  const projection = useMemo(() => {
    if (mode === 'china') {
      // 中国地图使用墨卡托投影，中心点 [105, 35]
      return geoMercator()
        .center([105, 35])
        .scale(600)
        .translate([width / 2, height / 2]);
    }
    // 世界地图使用等距圆柱投影
    return geoEquirectangular()
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2]);
  }, [mode, width, height]);

  // 创建 path 生成器
  const pathGenerator = useMemo(() => {
    return geoPath().projection(projection);
  }, [projection]);

  // GeoJSON 转 SVG path（使用 d3-geo）
  const geometryToPath = useCallback((geometry: MultiPolygon | Polygon): string => {
    const feature: Feature<MultiPolygon | Polygon> = {
      type: 'Feature',
      properties: {},
      geometry,
    };
    return pathGenerator(feature) || '';
  }, [pathGenerator]);

  // 区域填充：唯一强调色 + 透明度表达强度，交由 --sf-* 令牌切换深浅主题
  const getRegionFill = useCallback((regionId: string, mapMode: MapMode): string => {
    const data = mapMode === 'china' ? chinaData[regionId] : worldData[regionId];
    return data ? 'var(--sf-accent)' : 'var(--sf-line-soft)';
  }, [worldData, chinaData]);

  // 浏览量强度 -> 填充透明度（0.14 ~ 0.9），替代原先 6 档写死色阶
  const getRegionOpacity = useCallback((regionId: string, mapMode: MapMode): number => {
    const data = mapMode === 'china' ? chinaData[regionId] : worldData[regionId];
    if (!data) return 1;
    const intensity = maxViews > 0 ? Math.min(data.views / maxViews, 1) : 0;
    return 0.14 + intensity * 0.76;
  }, [worldData, chinaData, maxViews]);

  // 处理悬停
  const handleMouseEnter = useCallback((e: React.MouseEvent, regionId: string, name: string) => {
    const data = mode === 'china' ? chinaData[regionId] : worldData[regionId];
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setHoveredRegion({
        id: regionId,
        name,
        data,
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      });
    }
  }, [mode, worldData, chinaData]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRegion(null);
  }, []);

  // 缓存 path 计算，避免 hover 时全量重算
  const pathCache = useMemo(() => {
    const cache: Record<string, string> = {};
    const currentGeos = mode === 'china' ? chinaGeos : worldGeos;
    for (const geo of currentGeos) {
      let regionId: string;
      if (mode === 'china') {
        const adcode = geo.properties?.adcode as number;
        regionId = String(adcode);
      } else {
        regionId = geo.id || String(geo.properties?.['ISO_N3'] || '');
      }
      if (regionId) {
        cache[regionId] = geometryToPath(geo.geometry);
      }
    }
    return cache;
  }, [mode, chinaGeos, worldGeos, geometryToPath]);

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sf-line)] border-t-[var(--sf-accent)]" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-[var(--sf-ink-3)]">
        地图数据加载失败
      </div>
    );
  }

  const currentGeos = mode === 'china' ? chinaGeos : worldGeos;

  return (
    <div className="relative" ref={containerRef}>
      {/* 切换按钮 */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setMode('world')}
          aria-pressed={mode === 'world'}
          className={`rounded-[2px] border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
            mode === 'world'
              ? 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]'
              : 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]'
          }`}
        >
          国际地图
        </button>
        <button
          onClick={() => setMode('china')}
          aria-pressed={mode === 'china'}
          className={`rounded-[2px] border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] ${
            mode === 'china'
              ? 'border-[var(--sf-accent)] bg-[var(--sf-accent)] text-[var(--sf-on-accent)]'
              : 'border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink-2)] hover:border-[var(--sf-line-strong)] hover:text-[var(--sf-ink)]'
          }`}
        >
          中国地图
        </button>
      </div>

      {/* 地图容器 */}
      <div className="relative overflow-hidden rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-canvas)]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          style={{ maxHeight: mode === 'china' ? '500px' : '420px' }}
          role="img"
          aria-label={mode === 'china' ? '中国访客地理分布地图' : '国际访客地理分布地图'}
        >
          {currentGeos.map((geo, index) => {
            let regionId: string;
            let regionName: string;

            if (mode === 'china') {
              const adcode = geo.properties?.adcode as number;
              regionId = String(adcode);
              regionName = ADCODE_TO_PROVINCE[adcode] || geo.properties?.name || '未知';
            } else {
              regionId = geo.id || String(geo.properties?.['ISO_N3'] || '');
              regionName = geo.properties?.name || regionId;
            }

            const data = mode === 'china' ? chinaData[regionId] : worldData[regionId];
            const path = pathCache[regionId] || '';
            const isHovered = hoveredRegion?.id === regionId;

            return (
              <path
                key={regionId || `geo-${index}`}
                d={path}
                fill={getRegionFill(regionId, mode)}
                fillOpacity={getRegionOpacity(regionId, mode)}
                stroke={isHovered ? 'var(--sf-accent)' : 'var(--sf-line)'}
                strokeWidth={isHovered ? 2 : 0.5}
                className="cursor-pointer transition-all duration-150"
                style={{
                  filter: isHovered ? 'brightness(1.1)' : undefined,
                }}
                onMouseEnter={(e) => handleMouseEnter(e, regionId, regionName)}
                onMouseLeave={handleMouseLeave}
                role="img"
                aria-label={`${regionName}${data ? `，${data.views} 次浏览，${data.uv} 独立访客` : '，暂无数据'}`}
              />
            );
          })}
        </svg>

        {/* 悬停详情提示 */}
        {hoveredRegion && (
          <div
            className="pointer-events-none absolute z-10 rounded-[3px] border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 py-2"
            style={{
              left: Math.min(hoveredRegion.x + 10, (containerRef.current?.clientWidth || 300) - 150),
              top: Math.max(hoveredRegion.y - 10, 10),
            }}
          >
            <div className="text-sm font-semibold text-[var(--sf-ink)]">
              {hoveredRegion.name}
            </div>
            {hoveredRegion.data ? (
              <div className="mt-1 text-xs text-[var(--sf-ink-2)]">
                <div>{hoveredRegion.data.views} 次浏览</div>
                <div>{hoveredRegion.data.uv} 独立访客</div>
              </div>
            ) : (
              <div className="mt-1 text-xs text-[var(--sf-ink-3)]">暂无数据</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(GeoMap);
