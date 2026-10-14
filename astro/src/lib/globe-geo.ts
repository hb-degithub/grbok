/** Geographic math shared by deterministic sampling and front-surface picking. */
export interface GlobeFeature {
  properties?: { name?: string; iso_n3?: string; adcode?: number; [key: string]: unknown };
  geometry?: { type: string; coordinates: number[][][] | number[][][][] };
}
export type Location = [lng: number, lat: number];
const RAD = Math.PI / 180;

export function toSphere(lng: number, lat: number, radius: number): [number, number, number] {
  return [radius * Math.cos(lat * RAD) * Math.sin(lng * RAD), radius * Math.sin(lat * RAD), radius * Math.cos(lat * RAD) * Math.cos(lng * RAD)];
}
export function fromSphere(x: number, y: number, z: number): Location {
  return [Math.atan2(x, z) / RAD, Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z)))) / RAD];
}
export function polygonsOf(feature: GlobeFeature): number[][][][] {
  if (feature.geometry?.type === 'Polygon') return [feature.geometry.coordinates as number[][][]];
  if (feature.geometry?.type === 'MultiPolygon') return feature.geometry.coordinates as number[][][][];
  return [];
}
function inRing(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(polygon: number[][][], lng: number, lat: number): boolean {
  return !!polygon[0] && inRing(polygon[0], lng, lat) && !polygon.slice(1).some(ring => inRing(ring, lng, lat));
}
export function containsLocation(feature: GlobeFeature, lng: number, lat: number): boolean {
  return polygonsOf(feature).some(polygon => inPolygon(polygon, lng, lat));
}
/** Approximately equal-area rows keep polar regions from becoming dense clumps. */
export function sampleLand(feature: GlobeFeature, spacing: number): Location[] {
  const points: Location[] = [];
  for (const polygon of polygonsOf(feature)) {
    const ring = polygon[0];
    if (!ring?.length) continue;
    const lngs = ring.map(point => point[0]), lats = ring.map(point => point[1]);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const startCount = points.length;
    for (let lat = Math.ceil(minLat / spacing) * spacing; lat <= maxLat; lat += spacing) {
      const lngStep = spacing / Math.max(0.15, Math.cos(lat * RAD));
      for (let lng = Math.ceil(minLng / lngStep) * lngStep; lng <= maxLng; lng += lngStep) {
        if (inPolygon(polygon, lng, lat)) points.push([lng, lat]);
      }
    }
    if (points.length === startCount) {
      const center: Location = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
      if (inPolygon(polygon, ...center)) points.push(center);
    }
  }
  return points;
}
export function viewMaximum(data: Record<string, { views: number }>): number {
  return Math.max(1, ...Object.values(data).map(item => Number.isFinite(item.views) ? item.views : 0));
}
export function representativePoint(feature: GlobeFeature, samples: Location[]): Location | undefined {
  const supplied = feature.properties?.centroid ?? feature.properties?.center;
  if (Array.isArray(supplied) && supplied.length >= 2 && containsLocation(feature, supplied[0], supplied[1])) return [supplied[0], supplied[1]];
  if (!samples.length) return undefined;
  const average = samples.reduce((sum, point) => [sum[0] + point[0] / samples.length, sum[1] + point[1] / samples.length], [0, 0]);
  return samples.reduce((closest, point) => Math.hypot(point[0] - average[0], point[1] - average[1]) < Math.hypot(closest[0] - average[0], closest[1] - average[1]) ? point : closest);
}
