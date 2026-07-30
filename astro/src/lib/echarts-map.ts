/**
 * ECharts 按需引入 + 地图数据注册
 * 使用 tree-shaking 避免引入完整 ECharts（~1MB → ~300KB）
 */
import * as echarts from 'echarts/core';
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { MapChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import type { GeoJSON } from 'geojson';

// 注册必要组件
echarts.use([GeoComponent, TooltipComponent, VisualMapComponent, MapChart, CanvasRenderer]);

// 地图注册状态
let worldRegistered = false;
let chinaRegistered = false;

/**
 * 加载并注册世界地图（TopoJSON → GeoJSON）
 */
export async function registerWorldMap(): Promise<void> {
  if (worldRegistered) return;
  const res = await fetch('/countries-110m.json');
  if (!res.ok) throw new Error(`Failed to load world map: ${res.status}`);
  const topology = await res.json();

  // 动态导入 topojson-client 转换
  const { feature } = await import('topojson-client');
  const countries = topology.objects.countries;
  const geojson = feature(topology, countries) as unknown as GeoJSON;

  echarts.registerMap('world', geojson);
  worldRegistered = true;
}

/**
 * 加载并注册中国地图（标准 GeoJSON，含南海诸岛）
 * 数据来源：DataV.GeoAtlas（符合自然资源部标准）
 * 审图号：GS(2024)0650号（需根据实际数据源确认）
 */
export async function registerChinaMap(): Promise<void> {
  if (chinaRegistered) return;
  const res = await fetch('/china-provinces.json');
  if (!res.ok) throw new Error(`Failed to load china map: ${res.status}`);
  const geojson = (await res.json()) as GeoJSON;

  echarts.registerMap('china', geojson);
  chinaRegistered = true;
}

export { echarts };
export type EChartsInstance = ReturnType<typeof echarts.init>;
