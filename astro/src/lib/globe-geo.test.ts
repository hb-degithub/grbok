import { describe, expect, it } from 'vitest';
import { containsLocation, sampleLand, toSphere, fromSphere, viewMaximum, type GlobeFeature } from './globe-geo';

const island: GlobeFeature = { properties: { name: '测试岛' }, geometry: { type: 'Polygon', coordinates: [
  [[-6, -6], [6, -6], [6, 6], [-6, 6], [-6, -6]],
  [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
] } };

describe('data globe geography', () => {
  it('keeps sampled coastlines stable and excludes lakes', () => {
    const points = sampleLand(island, 1.4);
    expect(points.length).toBeGreaterThan(20);
    expect(points).toEqual(sampleLand(island, 1.4));
    expect(points.every(([lng, lat]) => containsLocation(island, lng, lat))).toBe(true);
    expect(points.some(([lng, lat]) => Math.abs(lng) < 2 && Math.abs(lat) < 2)).toBe(false);
  });
  it('round trips Asian and western coordinates without mirroring', () => {
    for (const [lng, lat] of [[105, 35], [-74, 41], [179, -25]]) {
      const [x, y, z] = toSphere(lng, lat, 150);
      const point = fromSphere(x, y, z);
      expect(point[0]).toBeCloseTo(lng, 6);
      expect(point[1]).toBeCloseTo(lat, 6);
      expect(Math.hypot(x, y, z)).toBeCloseTo(150, 6);
    }
  });
  it('normalizes provinces independently and handles empty data', () => {
    expect(viewMaximum({ BJ: { views: 25 }, GD: { views: 10 } })).toBe(25);
    expect(viewMaximum({})).toBe(1);
    expect(viewMaximum({ empty: { views: 0 } })).toBe(1);
  });
  it('finds individual islands in a MultiPolygon', () => {
    const multi: GlobeFeature = { geometry: { type: 'MultiPolygon', coordinates: [
      island.geometry!.coordinates as number[][][], [[[20, 20], [23, 20], [23, 23], [20, 23], [20, 20]]],
    ] } };
    expect(containsLocation(multi, 21, 21)).toBe(true);
    expect(containsLocation(multi, 12, 12)).toBe(false);
    expect(containsLocation(multi, 0, 0)).toBe(false);
  });
});
