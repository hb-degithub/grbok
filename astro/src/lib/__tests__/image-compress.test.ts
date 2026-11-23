import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPRESS_THRESHOLD_BYTES,
  JPEG_QUALITY,
  MAX_EDGE,
  compressImageFile,
  formatBytes,
  planCompression,
  renameForMime,
  type DecodedImage,
} from '../image-compress';

/**
 * 上传前压缩契约（2026-11 相册优化）。
 *
 * 生产现状：单张原图 9.25MB 直接上传。要求浏览器端 canvas 把长边压到 2560px、
 * JPEG 质量 0.85，并且任何压缩失败都必须回退原文件（压缩是优化，不能成为上传失败原因）。
 */

/** 造一个指定 size 的 File（不真的分配 9MB 内存） */
function makeFile(name: string, size: number, type: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

function fakeCanvas(blob: Blob | null) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  } as unknown as HTMLCanvasElement;
  return { canvas, drawImage };
}

function decoded(width: number, height: number, source?: unknown): DecodedImage {
  return { source: (source ?? {}) as CanvasImageSource, width, height };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planCompression · 尺寸与编码决策', () => {
  it('9.25MB / 4000x3000 JPEG 压到长边 2560、质量 0.85', () => {
    const plan = planCompression({ width: 4000, height: 3000, size: 9.7 * 1024 * 1024, type: 'image/jpeg' });

    expect(plan.needed).toBe(true);
    expect(plan.targetWidth).toBe(MAX_EDGE);
    expect(plan.targetHeight).toBe(1920);
    expect(plan.mimeType).toBe('image/jpeg');
    expect(plan.quality).toBe(JPEG_QUALITY);
  });

  it('横向超长图按长边等比缩放', () => {
    const plan = planCompression({ width: 3000, height: 1000, size: 2 * 1024 * 1024, type: 'image/jpeg' });
    expect(plan.targetWidth).toBe(2560);
    expect(plan.targetHeight).toBe(853);
  });

  it('PNG 转 webp 以保留透明通道', () => {
    const plan = planCompression({ width: 3000, height: 3000, size: 4 * 1024 * 1024, type: 'image/png' });
    expect(plan.needed).toBe(true);
    expect(plan.mimeType).toBe('image/webp');
  });

  it('小图不重编码', () => {
    const plan = planCompression({ width: 1200, height: 800, size: 200 * 1024, type: 'image/jpeg' });
    expect(plan.needed).toBe(false);
    expect(plan.reason).toBe('small-file');
  });

  it('GIF / SVG 等不做处理（可能是动图或矢量图）', () => {
    expect(planCompression({ width: 800, height: 600, size: 5 * 1024 * 1024, type: 'image/gif' })).toMatchObject({
      needed: false,
      reason: 'unsupported-type',
    });
    expect(planCompression({ width: 800, height: 600, size: 5 * 1024 * 1024, type: 'image/svg+xml' }).needed).toBe(false);
  });

  it('尺寸无效时不处理', () => {
    expect(planCompression({ width: 0, height: 0, size: 9 * 1024 * 1024, type: 'image/jpeg' }).reason).toBe(
      'invalid-dimensions',
    );
  });
});

describe('compressImageFile · 压缩与回退', () => {
  it('大图压缩成更小的 JPEG，并按目标尺寸绘制', async () => {
    const file = makeFile('photo.jpg', 9.7 * 1024 * 1024, 'image/jpeg');
    const { canvas, drawImage } = fakeCanvas(new Blob(['x'.repeat(64)], { type: 'image/jpeg' }));

    const result = await compressImageFile(file, {
      decode: async () => decoded(4000, 3000),
      createCanvas: () => canvas,
    });

    expect(result).not.toBe(file);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(canvas.width).toBe(2560);
    expect(canvas.height).toBe(1920);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1920);
    expect(result.size).toBeLessThan(file.size);
  });

  it('压缩后反而更大时回退原文件', async () => {
    const file = makeFile('photo.jpg', 600 * 1024, 'image/jpeg');
    // 输出 2MB > 原文件 600KB
    const { canvas } = fakeCanvas(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' }));

    const result = await compressImageFile(file, {
      decode: async () => decoded(4000, 3000),
      createCanvas: () => canvas,
    });

    expect(result).toBe(file);
  });

  it('PNG 转 webp；浏览器不支持 webp 编码（toBlob 回退 PNG）时保留原文件', async () => {
    const file = makeFile('logo.png', 3 * 1024 * 1024, 'image/png');
    const { canvas } = fakeCanvas(new Blob(['x'.repeat(32)], { type: 'image/png' }));

    const result = await compressImageFile(file, {
      decode: async () => decoded(3000, 3000),
      createCanvas: () => canvas,
    });

    expect(result).toBe(file);
  });

  it('PNG 成功转 webp 时扩展名同步为 .webp', async () => {
    const file = makeFile('logo.png', 3 * 1024 * 1024, 'image/png');
    const { canvas } = fakeCanvas(new Blob(['x'.repeat(32)], { type: 'image/webp' }));

    const result = await compressImageFile(file, {
      decode: async () => decoded(3000, 3000),
      createCanvas: () => canvas,
    });

    expect(result.name).toBe('logo.webp');
    expect(result.type).toBe('image/webp');
  });

  it('解码失败时回退原文件（不抛错）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = makeFile('broken.jpg', 9 * 1024 * 1024, 'image/jpeg');

    const result = await compressImageFile(file, {
      decode: async () => {
        throw new Error('decode failed');
      },
      createCanvas: () => fakeCanvas(null).canvas,
    });

    expect(result).toBe(file);
    expect(warn).toHaveBeenCalled();
  });

  it('canvas 不可用（getContext 返回 null）时回退原文件', async () => {
    const file = makeFile('photo.jpg', 9 * 1024 * 1024, 'image/jpeg');
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;

    const result = await compressImageFile(file, {
      decode: async () => decoded(4000, 3000),
      createCanvas: () => canvas,
    });

    expect(result).toBe(file);
  });

  it('不支持的类型直接原样返回（同一 File 实例）', async () => {
    const file = makeFile('anim.gif', 5 * 1024 * 1024, 'image/gif');
    const decode = vi.fn();
    const result = await compressImageFile(file, { decode });
    expect(result).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });

  it('小于阈值的文件跳过解码', async () => {
    const file = makeFile('small.jpg', COMPRESS_THRESHOLD_BYTES - 1, 'image/jpeg');
    const decode = vi.fn();
    const result = await compressImageFile(file, { decode });
    expect(result).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('辅助函数', () => {
  it('renameForMime 按编码替换扩展名', () => {
    expect(renameForMime('a/b.photo.JPEG', 'image/jpeg')).toBe('a/b.photo.jpg');
    expect(renameForMime('photo.png', 'image/webp')).toBe('photo.webp');
    expect(renameForMime('noext', 'image/jpeg')).toBe('noext.jpg');
  });

  it('formatBytes 输出可读体积', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(9.7 * 1024 * 1024)).toBe('9.7 MB');
  });
});
