/**
 * Three.js 粒子地球渲染引擎
 *
 * 从 world-zh.json GeoJSON 采样国家区域，生成球面粒子地球。
 * 支持鼠标拖拽旋转、自动自转、悬停交互、中国区域高亮。
 *
 * 零全局副作用：所有状态封装在 Globe3DEngine 类中。
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface GlobeGeoData {
  views: number;
  uv: number;
  name: string;
}

export interface Globe3DOptions {
  /** 容器元素 */
  container: HTMLElement;
  /** 国际数据：ISO numeric code → GeoData */
  worldData: Record<string, GlobeGeoData>;
  /** 中国数据：adcode → GeoData */
  chinaData: Record<string, GlobeGeoData>;
  /** 最大浏览量（用于颜色/大小归一化） */
  maxViews: number;
  /** 地图模式 */
  mode: 'world' | 'china';
  /** 悬停回调 */
  onHover?: (data: { name: string; views: number; uv: number } | null, x: number, y: number) => void;
}

interface ParticleInfo {
  /** 国家中文名 */
  countryName: string;
  /** ISO numeric code */
  isoN3: string;
  /** 是否为中国区域 */
  isChina: boolean;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const GLOBE_RADIUS = 150;
const BASE_PARTICLE_COUNT = 12000;
const AUTO_ROTATE_SPEED = 0.0008;
const HOVER_RAYCAST_THRESHOLD = 8;
const DRAG_SENSITIVITY = 0.008;
const ROTATION_SMOOTHING = 0.12;

// 颜色梯度（与 2D 地图保持一致）
const COLOR_RANGE = ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488'];
const BASE_PARTICLE_COLOR = '#71717a';
const DEFAULT_COUNTRY_COLOR = '#a1a1aa';
const CHINA_HIGHLIGHT_COLOR = '#14b8a6';
const CHINA_DIM_COLOR = '#3f3f46';
const BORDER_COLOR = '#52525b';
const BORDER_CHINA_COLOR = '#0d9488';

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 经纬度 → 球面坐标 */
function latLngToSphere(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

/** 按访问量获取颜色 */
function getColorByViews(views: number, maxViews: number): string {
  if (views <= 0 || maxViews <= 0) return DEFAULT_COUNTRY_COLOR;
  const ratio = Math.min(views / maxViews, 1);
  const idx = Math.min(Math.floor(ratio * COLOR_RANGE.length), COLOR_RANGE.length - 1);
  return COLOR_RANGE[idx];
}

/** 按访问量获取粒子大小 */
function getSizeByViews(views: number, maxViews: number): number {
  if (views <= 0 || maxViews <= 0) return 1.5;
  const ratio = Math.min(views / maxViews, 1);
  return 1.5 + ratio * 2.5;
}

/** 判断点是否在多边形内部（射线法） */
function isPointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** 判断点是否在 GeoJSON Feature 内部 */
function isPointInFeature(lat: number, lng: number, feature: GeoJSONFeature): boolean {
  if (!feature.geometry) return false;
  const { type, coordinates } = feature.geometry;

  if (type === 'Polygon') {
    const rings = coordinates as number[][][];
    if (rings[0] && isPointInPolygon(lat, lng, rings[0])) {
      for (let i = 1; i < rings.length; i++) {
        if (isPointInPolygon(lat, lng, rings[i])) return false;
      }
      return true;
    }
  } else if (type === 'MultiPolygon') {
    const polygons = coordinates as number[][][][];
    for (const polygon of polygons) {
      if (polygon[0] && isPointInPolygon(lat, lng, polygon[0])) {
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
          if (isPointInPolygon(lat, lng, polygon[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

// ── GeoJSON 采样 ──────────────────────────────────────────────────────────────

interface GeoJSONFeature {
  type: string;
  properties?: {
    name?: string;
    iso_a2?: string;
    iso_a3?: string;
    iso_n3?: string;
    adcode?: number;
    [key: string]: unknown;
  };
  geometry?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface GeoJSONCollection {
  type: string;
  features: GeoJSONFeature[];
}

/** 从 Feature 边界采样点（用于粒子） */
function sampleFeatureBoundary(feature: GeoJSONFeature, density: number): Array<{ lat: number; lng: number }> {
  if (!feature.geometry) return [];
  const { type, coordinates } = feature.geometry;
  const points: Array<{ lat: number; lng: number }> = [];

  if (type === 'Polygon') {
    const rings = coordinates as number[][][];
    if (rings[0]) {
      for (let i = 0; i < rings[0].length; i += density) {
        const [lng, lat] = rings[0][i];
        points.push({ lat, lng });
      }
    }
  } else if (type === 'MultiPolygon') {
    const polygons = coordinates as number[][][][];
    for (const polygon of polygons) {
      if (polygon[0]) {
        for (let i = 0; i < polygon[0].length; i += density) {
          const [lng, lat] = polygon[0][i];
          points.push({ lat, lng });
        }
      }
    }
  }
  return points;
}

/** 获取 Feature 的边界线（用于线条渲染） */
function getFeatureBoundaryLines(feature: GeoJSONFeature): Array<Array<{ lat: number; lng: number }>> {
  if (!feature.geometry) return [];
  const { type, coordinates } = feature.geometry;
  const lines: Array<Array<{ lat: number; lng: number }>> = [];

  if (type === 'Polygon') {
    const rings = coordinates as number[][][];
    for (const ring of rings) {
      const line: Array<{ lat: number; lng: number }> = [];
      for (const [lng, lat] of ring) {
        line.push({ lat, lng });
      }
      // 闭合线条
      if (line.length > 0) {
        line.push(line[0]);
      }
      lines.push(line);
    }
  } else if (type === 'MultiPolygon') {
    const polygons = coordinates as number[][][][];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const line: Array<{ lat: number; lng: number }> = [];
        for (const [lng, lat] of ring) {
          line.push({ lat, lng });
        }
        if (line.length > 0) {
          line.push(line[0]);
        }
        lines.push(line);
      }
    }
  }
  return lines;
}

/** 在 Feature 内部均匀采样点 */
function sampleFeatureInterior(feature: GeoJSONFeature, count: number): Array<{ lat: number; lng: number }> {
  if (!feature.geometry) return [];
  const points: Array<{ lat: number; lng: number }> = [];

  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  const boundary = sampleFeatureBoundary(feature, 1);
  for (const pt of boundary) {
    minLat = Math.min(minLat, pt.lat);
    maxLat = Math.max(maxLat, pt.lat);
    minLng = Math.min(minLng, pt.lng);
    maxLng = Math.max(maxLng, pt.lng);
  }

  let attempts = 0;
  const maxAttempts = count * 20;
  while (points.length < count && attempts < maxAttempts) {
    attempts++;
    const lat = minLat + Math.random() * (maxLat - minLat);
    const lng = minLng + Math.random() * (maxLng - minLng);
    if (isPointInFeature(lat, lng, feature)) {
      points.push({ lat, lng });
    }
  }

  return points;
}

// ── 引擎类 ────────────────────────────────────────────────────────────────────

export class Globe3DEngine {
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private points: import('three').Points | null = null;
  private basePoints: import('three').Points | null = null;
  private borderLines: import('three').LineSegments | null = null;
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private raycaster: import('three').Raycaster | null = null;
  private mouse: import('three').Vector2 | null = null;

  // 旋转状态
  private rotationX = 0;
  private rotationY = 0;
  private targetRotationX = 0;
  private targetRotationY = 0;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private autoRotate = true;

  // 粒子数据
  private particleInfos: ParticleInfo[] = [];
  private hoveredIndex = -1;

  // 配置
  private options: Globe3DOptions;
  private container: HTMLElement;
  private destroyed = false;
  private threeModule: typeof import('three') | null = null;

  constructor(options: Globe3DOptions) {
    this.options = options;
    this.container = options.container;
  }

  /** 初始化（懒加载 Three.js） */
  async init(): Promise<void> {
    this.threeModule = await import('three');
    const THREE = this.threeModule;

    if (!this.isWebGLSupported()) {
      throw new Error('WebGL not supported');
    }

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);

    // 场景
    this.scene = new THREE.Scene();

    // 相机
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.z = 400;

    // 射线检测
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: HOVER_RAYCAST_THRESHOLD };
    this.mouse = new THREE.Vector2(-999, -999);

    // 构建基础球体粒子（形成地球轮廓）
    this.buildBaseSphere();

    // 加载并构建国家粒子和边界线
    await this.buildParticles();

    // 事件监听
    this.setupEvents();

    // 响应式
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // 开始渲染循环
    this.animate();
  }

  /** 更新数据和模式 */
  updateData(worldData: Record<string, GlobeGeoData>, chinaData: Record<string, GlobeGeoData>, maxViews: number, mode: 'world' | 'china'): void {
    this.options.worldData = worldData;
    this.options.chinaData = chinaData;
    this.options.maxViews = maxViews;
    this.options.mode = mode;
    if (this.threeModule) {
      this.rebuildParticles();
    }
  }

  /** 销毁 */
  destroy(): void {
    this.destroyed = true;
    this.autoRotate = false;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.removeEvents();

    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as import('three').Material).dispose();
      this.scene?.remove(this.points);
      this.points = null;
    }

    if (this.basePoints) {
      this.basePoints.geometry.dispose();
      (this.basePoints.material as import('three').Material).dispose();
      this.scene?.remove(this.basePoints);
      this.basePoints = null;
    }

    if (this.borderLines) {
      this.borderLines.geometry.dispose();
      (this.borderLines.material as import('three').Material).dispose();
      this.scene?.remove(this.borderLines);
      this.borderLines = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.raycaster = null;
    this.mouse = null;
    this.particleInfos = [];
    this.threeModule = null;
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────────

  private isWebGLSupported(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  }

  /** 构建基础球体粒子（形成地球轮廓背景） */
  private buildBaseSphere(): void {
    if (!this.threeModule || !this.scene) return;
    const THREE = this.threeModule;

    const positions: number[] = [];
    const colors: number[] = [];
    const baseColor = new THREE.Color(BASE_PARTICLE_COLOR);

    // 使用 Fibonacci 球面均匀分布
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < BASE_PARTICLE_COUNT; i++) {
      const theta = 2 * Math.PI * i / goldenRatio;
      const phi = Math.acos(1 - 2 * (i + 0.5) / BASE_PARTICLE_COUNT);
      const x = GLOBE_RADIUS * Math.sin(phi) * Math.cos(theta);
      const y = GLOBE_RADIUS * Math.cos(phi);
      const z = GLOBE_RADIUS * Math.sin(phi) * Math.sin(theta);

      positions.push(x, y, z);
      colors.push(baseColor.r, baseColor.g, baseColor.b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.0,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    this.basePoints = new THREE.Points(geometry, material);
    this.scene.add(this.basePoints);
  }

  /** 构建国家区域粒子和边界线 */
  private async buildParticles(): Promise<void> {
    if (!this.threeModule || !this.scene) return;
    const THREE = this.threeModule;

    // 根据模式加载不同的 GeoJSON
    const isChinaMode = this.options.mode === 'china';
    const geojsonUrl = isChinaMode ? '/china-provinces.json' : '/world-zh.json';
    const res = await fetch(geojsonUrl);
    if (!res.ok) throw new Error(`Failed to load map: ${res.status}`);
    const geojson = (await res.json()) as GeoJSONCollection;

    // 收集所有粒子
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    this.particleInfos = [];

    // 收集所有边界线
    const linePositions: number[] = [];
    const lineColors: number[] = [];

    // 中国相关 ISO 代码
    const CHINA_ISO = new Set(['156', '344', '158', '446']);

    for (const feature of geojson.features) {
      const name = feature.properties?.name || '';
      const isoN3 = feature.properties?.iso_n3 || '';
      const isoA2 = feature.properties?.iso_a2 || '';
      const adcode = feature.properties?.adcode?.toString() || '';

      // 跳过极地
      if (name === '南极洲' || name === '法属南部和南极领地') continue;
      // 跳过不被承认的条目
      if (name === '北塞浦路斯' || name === '索马里兰' || name === '锡亚琴冰川') continue;

      const isChina = CHINA_ISO.has(isoN3) || isoA2 === 'CN' || isoA2 === 'HK' || isoA2 === 'TW' || isoA2 === 'MO';
      
      // 获取访问量数据
      let geoData: GlobeGeoData | undefined;
      if (isChinaMode) {
        // 中国模式：使用 adcode 匹配
        geoData = this.options.chinaData[adcode];
      } else {
        // 世界模式：使用 ISO numeric code 匹配
        geoData = this.options.worldData[isoN3];
      }

      // 采样内部点（填充国家/省份区域）
      const interiorPoints = sampleFeatureInterior(feature, isChinaMode ? 50 : 30);

      for (const pt of interiorPoints) {
        const [x, y, z] = latLngToSphere(pt.lat, pt.lng, GLOBE_RADIUS + 0.3);
        positions.push(x, y, z);

        // 颜色
        let color: string;
        if (isChinaMode) {
          // 中国模式：按省份访问量着色
          color = geoData ? getColorByViews(geoData.views, this.options.maxViews) : DEFAULT_COUNTRY_COLOR;
        } else {
          // 世界模式：按国家访问量着色
          color = geoData ? getColorByViews(geoData.views, this.options.maxViews) : DEFAULT_COUNTRY_COLOR;
        }
        const c = new THREE.Color(color);
        colors.push(c.r, c.g, c.b);

        // 大小
        const size = geoData ? getSizeByViews(geoData.views, this.options.maxViews) : 1.5;
        sizes.push(size);

        this.particleInfos.push({
          countryName: name,
          isoN3: isChinaMode ? adcode : isoN3,
          isChina,
        });
      }

      // 构建边界线
      const boundaryLines = getFeatureBoundaryLines(feature);
      const borderColor = isChinaMode ? BORDER_CHINA_COLOR : BORDER_COLOR;
      const bc = new THREE.Color(borderColor);

      for (const line of boundaryLines) {
        for (let i = 0; i < line.length - 1; i++) {
          const [x1, y1, z1] = latLngToSphere(line[i].lat, line[i].lng, GLOBE_RADIUS + 0.5);
          const [x2, y2, z2] = latLngToSphere(line[i + 1].lat, line[i + 1].lng, GLOBE_RADIUS + 0.5);
          linePositions.push(x1, y1, z1, x2, y2, z2);
          lineColors.push(bc.r, bc.g, bc.b, bc.r, bc.g, bc.b);
        }
      }
    }

    // 创建粒子几何体
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    // 粒子材质
    const material = new THREE.PointsMaterial({
      size: 2.0,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        'uniform float size;',
        'attribute float size;'
      );
    };

    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);

    // 创建边界线几何体
    if (linePositions.length > 0) {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));

      const lineMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
      });

      this.borderLines = new THREE.LineSegments(lineGeometry, lineMaterial);
      this.scene.add(this.borderLines);
    }
  }

  private rebuildParticles(): void {
    if (!this.threeModule || !this.scene) return;

    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as import('three').Material).dispose();
      this.scene.remove(this.points);
      this.points = null;
    }

    if (this.borderLines) {
      this.borderLines.geometry.dispose();
      (this.borderLines.material as import('three').Material).dispose();
      this.scene.remove(this.borderLines);
      this.borderLines = null;
    }

    this.buildParticles().catch(console.error);
  }

  private setupEvents(): void {
    if (!this.renderer) return;
    const el = this.renderer.domElement;

    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.style.cursor = 'grab';
  }

  private removeEvents(): void {
    if (!this.renderer) return;
    const el = this.renderer.domElement;

    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.isDragging = true;
    this.autoRotate = false;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    if (this.renderer) {
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.container || !this.mouse) return;

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.isDragging) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.targetRotationY += dx * DRAG_SENSITIVITY;
      this.targetRotationX += dy * DRAG_SENSITIVITY;
      this.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetRotationX));
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  };

  private onPointerUp = (): void => {
    this.isDragging = false;
    setTimeout(() => {
      if (!this.destroyed) this.autoRotate = true;
    }, 2000);
    if (this.renderer) {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  private onPointerLeave = (): void => {
    this.isDragging = false;
    if (this.mouse) {
      this.mouse.x = -999;
      this.mouse.y = -999;
    }
    this.hoveredIndex = -1;
    this.options.onHover?.(null, 0, 0);
    if (this.renderer) {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  private handleResize(): void {
    if (!this.renderer || !this.camera || !this.container) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    if (this.destroyed || !this.renderer || !this.scene || !this.camera) return;

    this.animationId = requestAnimationFrame(this.animate);

    // 自动旋转
    if (this.autoRotate && !this.isDragging) {
      this.targetRotationY += AUTO_ROTATE_SPEED;
    }

    // 平滑旋转
    this.rotationY += (this.targetRotationY - this.rotationY) * ROTATION_SMOOTHING;
    this.rotationX += (this.targetRotationX - this.rotationX) * ROTATION_SMOOTHING;

    // 同时旋转所有元素
    if (this.basePoints) {
      this.basePoints.rotation.y = this.rotationY;
      this.basePoints.rotation.x = this.rotationX * 0.3;
    }
    if (this.points) {
      this.points.rotation.y = this.rotationY;
      this.points.rotation.x = this.rotationX * 0.3;
    }
    if (this.borderLines) {
      this.borderLines.rotation.y = this.rotationY;
      this.borderLines.rotation.x = this.rotationX * 0.3;
    }

    // 悬停检测
    if (this.raycaster && this.mouse && this.mouse.x > -2 && this.points) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.points);

      if (intersects.length > 0) {
        const idx = intersects[0].index;
        if (idx !== undefined && idx !== this.hoveredIndex) {
          this.hoveredIndex = idx;
          const info = this.particleInfos[idx];
          if (info && this.options.onHover) {
            // 根据模式从不同的数据源获取数据
            const isChinaMode = this.options.mode === 'china';
            const geoData = isChinaMode
              ? this.options.chinaData[info.isoN3]
              : this.options.worldData[info.isoN3];
            this.options.onHover(
              {
                name: info.countryName,
                views: geoData?.views ?? 0,
                uv: geoData?.uv ?? 0,
              },
              this.mouse.x,
              this.mouse.y
            );
          }
        }
      } else if (this.hoveredIndex !== -1) {
        this.hoveredIndex = -1;
        this.options.onHover?.(null, 0, 0);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}
