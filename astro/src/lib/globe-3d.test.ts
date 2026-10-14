import { afterEach, describe, expect, it, vi } from 'vitest';
import { Globe3DEngine } from './globe-3d';

afterEach(() => vi.unstubAllGlobals());

describe('Globe3DEngine lifecycle', () => {
  it('aborts map requests and does not create a renderer after being unmounted', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return new Promise(resolve => resolvers.push(resolve));
    });
    const container = document.createElement('div');
    const onRotationChange = vi.fn();
    const engine = new Globe3DEngine({ container, worldData: {}, onRotationChange });
    const initializing = engine.init();
    engine.destroy();
    for (const resolve of resolvers) resolve({ ok: true, json: async () => ({ features: [] }) });
    await initializing;
    expect(signals).toHaveLength(1);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(container.querySelector('canvas')).toBeNull();
    expect(onRotationChange).not.toHaveBeenCalled();
    expect(() => engine.destroy()).not.toThrow();
  });
});
