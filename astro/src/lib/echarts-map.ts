/**
 * ECharts 按需引入 + 地图数据注册
 * 使用 tree-shaking 避免引入完整 ECharts（~1MB → ~300KB）
 *
 * 世界地图数据源：world-geo-json-zh（基于 Natural Earth 1:50m，按中国标准修正）
 * - 台湾/香港/澳门已合并到中国要素中
 * - 含南海诸岛岛礁、钓鱼岛
 * - 藏南/黑瞎子岛边界已按中国立场修正
 * - 过滤北塞浦路斯、索马里兰等不被中国承认的条目
 */
import * as echarts from 'echarts/core';
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { MapChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import type { GeoJSON, FeatureCollection, Feature } from 'geojson';

// 注册必要组件
echarts.use([GeoComponent, TooltipComponent, VisualMapComponent, MapChart, CanvasRenderer]);

// 地图注册状态（Promise 缓存防并发重复 fetch）
let worldPromise: Promise<void> | null = null;
let chinaPromise: Promise<void> | null = null;

/** 不被中国承认的条目（iso_n3 = -99），注册时过滤掉 */
const EXCLUDED_REGIONS = new Set(['北塞浦路斯', '索马里兰', '锡亚琴冰川']);

/** 访客统计地图不需要显示的极地/无人区要素（避免横线等视觉干扰） */
const EXCLUDED_POLAR = new Set(['南极洲', '法属南部和南极领地']);

/**
 * 加载并注册世界地图（GeoJSON，已按中国标准修正）
 * Promise 缓存：并发调用只 fetch 一次，失败后可重试
 */
export function registerWorldMap(): Promise<void> {
  worldPromise ??= (async () => {
    const res = await fetch('/world-zh.json');
    if (!res.ok) throw new Error(`Failed to load world map: ${res.status}`);
    const geojson = (await res.json()) as FeatureCollection;

    // 过滤不被中国承认的条目和极地要素
    const filtered: FeatureCollection = {
      type: 'FeatureCollection',
      features: geojson.features.filter(
        (f: Feature) => {
          const name = f.properties?.name || '';
          return !EXCLUDED_REGIONS.has(name) && !EXCLUDED_POLAR.has(name);
        }
      ),
    };

    echarts.registerMap('world', filtered as unknown as Parameters<typeof echarts.registerMap>[1]);
  })().catch((err) => {
    worldPromise = null; // 失败时重置，允许重试
    throw err;
  });
  return worldPromise;
}

/**
 * 加载并注册中国地图（标准 GeoJSON，含南海诸岛）
 * 数据来源：DataV.GeoAtlas（符合自然资源部标准）
 * 审图号：GS(2024)0650号（需根据实际数据源确认）
 */
export function registerChinaMap(): Promise<void> {
  chinaPromise ??= (async () => {
    const res = await fetch('/china-provinces.json');
    if (!res.ok) throw new Error(`Failed to load china map: ${res.status}`);
    const geojson = (await res.json()) as GeoJSON;

    echarts.registerMap('china', geojson as Parameters<typeof echarts.registerMap>[1]);
  })().catch((err) => {
    chinaPromise = null; // 失败时重置，允许重试
    throw err;
  });
  return chinaPromise;
}

export { echarts };
export type EChartsInstance = ReturnType<typeof echarts.init>;
