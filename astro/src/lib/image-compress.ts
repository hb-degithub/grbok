/**
 * 上传前图片压缩（浏览器端 canvas）
 *
 * 背景（2026-11 实测）：相册单张原图 9.25 MB，直接上传既慢又占用 PocketBase 存储。
 * 这里在**上传前**把长边压到 2560px 以内、JPEG 质量 0.85，把 9MB 压到数百 KB。
 *
 * 约定：
 * - 只处理浏览器可解码的位图（jpeg / png / webp）；GIF（可能动图）、SVG 原样放行；
 * - 小于 `COMPRESS_THRESHOLD_BYTES` 的文件直接放行，不做无意义的重编码；
 * - PNG 可能带透明通道，优先转 `image/webp`（webp 保留 alpha）；
 *   浏览器不支持 webp 编码时 `canvas.toBlob` 会回退成 PNG，此时**保留原文件**，
 *   避免"压缩"出更大的 PNG；
 * - 压缩后反而更大、解码失败、canvas 不可用 —— 任何异常都**回退原文件**，
 *   压缩是优化，不能成为上传失败的原因。
 */

/** 长边上限（px） */
export const MAX_EDGE = 2560;
/** JPEG 质量 */
export const JPEG_QUALITY = 0.85;
/** 低于该体积不做重编码 */
export const COMPRESS_THRESHOLD_BYTES = 512 * 1024;

const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface CompressionPlanInput {
  width: number;
  height: number;
  size: number;
  type: string;
}

export interface CompressionPlan {
  needed: boolean;
  /** 不需要压缩时的原因（便于在上传日志里说明为什么原图直传） */
  reason: 'needed' | 'unsupported-type' | 'small-file' | 'invalid-dimensions';
  targetWidth: number;
  targetHeight: number;
  mimeType: string;
  quality: number;
}

function targetMimeType(type: string): string {
  // PNG 转 webp 以保留透明通道；其余统一用 JPEG（照片体积最小）。
  if (type === 'image/png' || type === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * 纯函数：决定是否需要压缩、压到多大、用什么编码。
 * 与 DOM 无关，单测可以直接断言尺寸算法。
 */
export function planCompression(input: CompressionPlanInput): CompressionPlan {
  const { width, height, size, type } = input;
  const mimeType = targetMimeType(type);

  const passthrough = (reason: CompressionPlan['reason']): CompressionPlan => ({
    needed: false,
    reason,
    targetWidth: Math.max(0, Math.round(width)),
    targetHeight: Math.max(0, Math.round(height)),
    mimeType,
    quality: JPEG_QUALITY,
  });

  if (!COMPRESSIBLE_TYPES.has(type)) return passthrough('unsupported-type');
  if (!(width > 0) || !(height > 0)) return passthrough('invalid-dimensions');

  const longEdge = Math.max(width, height);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;

  // 尺寸已经够小、体积也不大：没必要为了几百字节去重编码。
  if (scale === 1 && size <= COMPRESS_THRESHOLD_BYTES) return passthrough('small-file');

  return {
    needed: true,
    reason: 'needed',
    targetWidth: Math.max(1, Math.round(width * scale)),
    targetHeight: Math.max(1, Math.round(height * scale)),
    mimeType,
    quality: JPEG_QUALITY,
  };
}

/** 把文件扩展名换成目标编码对应的扩展名（PocketBase 依赖原始文件名的扩展判断类型） */
export function renameForMime(name: string, mimeType: string): string {
  const ext = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.${ext}`;
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup?: () => void;
}

export interface CompressOptions {
  /** 解码实现，测试可注入；默认 createImageBitmap → Image 回退 */
  decode?: (file: File) => Promise<DecodedImage>;
  /** canvas 工厂，测试可注入 */
  createCanvas?: () => HTMLCanvasElement;
}

async function decodeWithImage(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function defaultDecode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close?.(),
    };
  }
  return decodeWithImage(file);
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * 压缩一个图片文件。
 *
 * 永远不会 throw：任何一步失败都返回原文件（调用方无需要额外兜底）。
 */
export async function compressImageFile(file: File, options: CompressOptions = {}): Promise<File> {
  try {
    // 快速放行：类型不支持 / 体积本来就小
    if (!COMPRESSIBLE_TYPES.has(file.type)) return file;
    if (file.size <= COMPRESS_THRESHOLD_BYTES) return file;
    if (typeof document === 'undefined') return file;

    const decode = options.decode ?? defaultDecode;
    const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'));

    const decoded = await decode(file);
    try {
      const plan = planCompression({
        width: decoded.width,
        height: decoded.height,
        size: file.size,
        type: file.type,
      });
      if (!plan.needed) return file;

      const canvas = createCanvas();
      canvas.width = plan.targetWidth;
      canvas.height = plan.targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.drawImage(decoded.source, 0, 0, plan.targetWidth, plan.targetHeight);

      const blob = await canvasToBlob(canvas, plan.mimeType, plan.quality);
      if (!blob) return file;

      // webp 编码不被支持时浏览器会静默回退成 PNG：PNG 重编码通常更大，保留原图更划算。
      if (plan.mimeType === 'image/webp' && blob.type !== 'image/webp') return file;
      // 压完反而更大：不划算，回退原文件。
      if (blob.size >= file.size) return file;

      return new File([blob], renameForMime(file.name, blob.type), {
        type: blob.type,
        lastModified: file.lastModified,
      });
    } finally {
      decoded.cleanup?.();
    }
  } catch (err) {
    console.warn('[gallery] 图片压缩失败，回退原文件：', err);
    return file;
  }
}

/** 文件体积可读化（上传进度条/提示文案共用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}
