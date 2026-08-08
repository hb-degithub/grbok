/**
 * 地图模式切换粒子动效系统
 *
 * 从 ECharts Canvas 采样像素生成粒子，实现"破碎→飞散→聚合"过渡动画。
 * 零依赖，纯 Canvas 2D + requestAnimationFrame。
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  /** 预存的不透明颜色字符串（避免每帧拼接 rgba()） */
  fillStyle: string;
  alpha: number;
  size: number;
}

interface ParticleSystemOptions {
  /** 粒子数量上限（根据设备性能自动降级） */
  maxParticles?: number;
  /** 破碎阶段时长（ms） */
  shatterDuration?: number;
  /** 过渡阶段时长（ms） */
  driftDuration?: number;
  /** 聚合阶段时长（ms） */
  gatherDuration?: number;
  /** 动画完成回调 */
  onComplete?: () => void;
  /** 聚合阶段接近完成时回调（用于淡入新地图） */
  onGatherNearComplete?: () => void;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PARTICLES = 10000;
const SHATTER_DURATION = 400;
const DRIFT_DURATION = 200;
const GATHER_DURATION = 600;

/** 缓动函数：easeOutCubic */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 缓动函数：easeInQuad */
function easeInQuad(t: number): number {
  return t * t;
}

// ── 设备性能检测 ──────────────────────────────────────────────────────────────

function getOptimalParticleCount(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile || cores <= 2) return 4000;
  if (cores <= 4 || dpr > 2) return 7000;
  return DEFAULT_MAX_PARTICLES;
}

// ── 像素采样 ──────────────────────────────────────────────────────────────────

/**
 * 从 Canvas 元素采样像素，生成粒子数组
 */
function sampleCanvasAsParticles(
  sourceCanvas: HTMLCanvasElement,
  maxParticles: number,
  containerWidth: number,
  containerHeight: number
): Particle[] {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return [];

  const { width, height } = sourceCanvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // 计算采样步长：确保粒子数不超过 maxParticles
  const totalPixels = width * height;
  const estimatedParticles = totalPixels / 4; // RGBA 4 通道
  const step = Math.max(1, Math.floor(Math.sqrt(estimatedParticles / maxParticles)));

  const particles: Particle[] = [];
  const scaleX = containerWidth / width;
  const scaleY = containerHeight / height;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3];

      // 跳过透明像素
      if (alpha < 30) continue;

      particles.push({
        x: x * scaleX,
        y: y * scaleY,
        vx: 0,
        vy: 0,
        targetX: 0,
        targetY: 0,
        fillStyle: `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`,
        alpha: alpha / 255,
        size: Math.max(1, step * scaleX * 0.8),
      });
    }
  }

  return particles;
}

// ── 粒子系统类 ────────────────────────────────────────────────────────────────

export class MapParticleTransition {
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private animationId: number | null = null;
  private switchTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveFn: (() => void) | null = null;
  private particles: Particle[] = [];
  private startTime: number = 0;
  private phase: 'shatter' | 'drift' | 'gather' | 'done' = 'shatter';
  private options: Required<ParticleSystemOptions>;
  private containerEl: HTMLElement | null = null;
  private destroyed = false;

  constructor(options: ParticleSystemOptions = {}) {
    this.options = {
      maxParticles: options.maxParticles ?? getOptimalParticleCount(),
      shatterDuration: options.shatterDuration ?? SHATTER_DURATION,
      driftDuration: options.driftDuration ?? DRIFT_DURATION,
      gatherDuration: options.gatherDuration ?? GATHER_DURATION,
      onComplete: options.onComplete ?? (() => {}),
      onGatherNearComplete: options.onGatherNearComplete ?? (() => {}),
    };
  }

  /**
   * 启动粒子过渡动画
   * @param sourceCanvas 当前 ECharts 的 Canvas 元素（旧地图）
   * @param containerEl ECharts 容器元素
   * @param onSwitchMap 在过渡阶段调用的回调（用于切换 ECharts 地图）
   */
  async start(
    sourceCanvas: HTMLCanvasElement,
    containerEl: HTMLElement,
    onSwitchMap: () => void
  ): Promise<void> {
    this.containerEl = containerEl;
    const rect = containerEl.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 1. 采样旧地图像素生成粒子
    this.particles = sampleCanvasAsParticles(
      sourceCanvas,
      this.options.maxParticles,
      width,
      height
    );

    if (this.particles.length === 0) {
      // 采样失败，直接切换
      onSwitchMap();
      this.options.onComplete();
      return;
    }

    // 2. 创建覆盖层 Canvas
    this.createOverlay(width, height);

    // 3. 给粒子赋随机初速度（破碎效果）
    const centerX = width / 2;
    const centerY = height / 2;
    for (const p of this.particles) {
      const dx = p.x - centerX;
      const dy = p.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const speed = 2 + Math.random() * 6;
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 1; // 轻微向上飘
    }

    // 4. 开始动画
    this.phase = 'shatter';
    this.startTime = performance.now();

    return new Promise<void>((resolve) => {
      this.resolveFn = resolve;
      const originalOnComplete = this.options.onComplete;
      this.options.onComplete = () => {
        originalOnComplete();
        this.resolveFn = null;
        resolve();
      };

      // 在破碎+漂移阶段结束后切换地图
      const switchTime = this.options.shatterDuration + this.options.driftDuration;
      this.switchTimer = setTimeout(() => {
        this.switchTimer = null;
        if (this.destroyed) return;
        onSwitchMap();
        // 切换后重新采样目标位置
        this.retargetParticles(width, height);
      }, switchTime);

      this.animate();
    });
  }

  /**
   * 停止动画并清理（保证 Promise 一定 settle）
   */
  destroy(): void {
    this.destroyed = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.switchTimer !== null) {
      clearTimeout(this.switchTimer);
      this.switchTimer = null;
    }
    if (this.overlayCanvas && this.overlayCanvas.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    }
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.particles = [];
    this.containerEl = null;
    // 保证 Promise settle，避免调用方 await 永久挂起
    if (this.resolveFn) {
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────────

  private createOverlay(width: number, height: number): void {
    if (!this.containerEl) return;

    // 确保容器有相对定位
    const computedStyle = getComputedStyle(this.containerEl);
    if (computedStyle.position === 'static') {
      this.containerEl.style.position = 'relative';
    }

    // Retina 适配：Canvas 物理像素 = CSS 像素 × DPR
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = width * dpr;
    this.overlayCanvas.height = height * dpr;
    this.overlayCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    `;

    this.containerEl.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    if (this.overlayCtx && dpr > 1) {
      this.overlayCtx.scale(dpr, dpr);
    }
  }

  private retargetParticles(width: number, height: number): void {
    // 为聚合阶段设置目标位置
    // 粒子从当前位置飞向随机分布的目标位置（模拟新地图的形状）
    // 由于此时 ECharts 已切换但还未渲染完成，我们用简单的随机分布
    // 粒子会在聚合阶段自然形成新的图案
    for (const p of this.particles) {
      p.targetX = Math.random() * width;
      p.targetY = Math.random() * height;
    }
    this.phase = 'gather';
    this.startTime = performance.now();
  }

  private gatherNearCompleteFired = false;
  private lastFrameTime = 0;

  private animate = (): void => {
    if (!this.overlayCtx || !this.overlayCanvas || this.destroyed) return;

    const now = performance.now();
    const elapsed = now - this.startTime;
    // 帧时间归一化：以 60fps 为基准，高刷屏不会加速动画
    const dt = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 16.67, 3) : 1;
    this.lastFrameTime = now;
    const ctx = this.overlayCtx;
    const canvas = this.overlayCanvas;

    // 清空画布（用 CSS 像素尺寸，因为 ctx.scale 已处理 DPR）
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (const p of this.particles) {
      switch (this.phase) {
        case 'shatter': {
          const progress = Math.min(elapsed / this.options.shatterDuration, 1);
          const eased = easeInQuad(progress);
          p.x += p.vx * (1 + eased * 2) * dt;
          p.y += p.vy * (1 + eased * 2) * dt;
          p.vy += 0.15 * dt; // 重力
          p.alpha = Math.max(0, p.alpha - 0.008 * dt);
          break;
        }
        case 'drift': {
          p.x += p.vx * 0.5 * dt;
          p.y += p.vy * 0.5 * dt;
          p.vx *= Math.pow(0.98, dt); // 阻尼
          p.vy *= Math.pow(0.98, dt);
          break;
        }
        case 'gather': {
          const progress = Math.min(elapsed / this.options.gatherDuration, 1);
          const eased = easeOutCubic(progress);
          p.x += (p.targetX - p.x) * eased * 0.15 * dt;
          p.y += (p.targetY - p.y) * eased * 0.15 * dt;
          p.alpha = Math.min(1, p.alpha + 0.02 * dt);
          break;
        }
        case 'done':
          break;
      }

      // 绘制粒子（预存 fillStyle + globalAlpha 控制透明度）
      if (p.alpha > 0.01) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.fillStyle;
        const s = p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;

    // 检查是否完成
    if (this.phase === 'shatter' && elapsed >= this.options.shatterDuration) {
      this.phase = 'drift';
      this.startTime = now;
    } else if (this.phase === 'drift' && elapsed >= this.options.driftDuration) {
      // drift 结束由 retargetParticles 处理（切换到 gather）
    } else if (this.phase === 'gather') {
      // 聚合阶段 70% 时触发回调（用于淡入新地图）
      if (!this.gatherNearCompleteFired && elapsed >= this.options.gatherDuration * 0.7) {
        this.gatherNearCompleteFired = true;
        this.options.onGatherNearComplete();
      }
      if (elapsed >= this.options.gatherDuration) {
        this.phase = 'done';
      }
    }

    if (this.phase === 'done') {
      this.destroy();
      this.options.onComplete();
      return;
    }

    this.animationId = requestAnimationFrame(this.animate);
  };
}

/**
 * 便捷函数：执行地图模式切换的粒子过渡动画
 * 返回 { promise, destroy } 句柄，调用方可在组件卸载时取消动画
 */
export function playMapTransition(
  sourceCanvas: HTMLCanvasElement,
  containerEl: HTMLElement,
  onSwitchMap: () => void,
  options?: ParticleSystemOptions
): { promise: Promise<void>; destroy: () => void } {
  const transition = new MapParticleTransition(options);
  const promise = transition.start(sourceCanvas, containerEl, onSwitchMap);
  return {
    promise,
    destroy: () => transition.destroy(),
  };
}
