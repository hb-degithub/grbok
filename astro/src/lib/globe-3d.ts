import { containsLocation, fromSphere, polygonsOf, representativePoint, sampleLand, toSphere, viewMaximum, type GlobeFeature, type Location } from './globe-geo';
import type * as Three from 'three';

export interface GlobeGeoData { views: number; uv: number; name: string }
export interface Globe3DOptions {
  container: HTMLElement;
  worldData: Record<string, GlobeGeoData>;
  onHover?: (data: GlobeGeoData | null, x: number, y: number) => void;
  onRotationChange?: (rotating: boolean) => void;
  onError?: () => void;
}
interface Region { feature: GlobeFeature; id: string; points: Location[]; center?: Location }
const RADIUS = 150, RAD = Math.PI / 180;
const PALETTES = {
  light: { ocean: '#bbcdd3', land: '#617e89', border: '#658491', grid: '#547580', low: '#329e97', high: '#00796e', halo: '#65b8b3' },
  dark: { ocean: '#152735', land: '#668894', border: '#54737f', grid: '#476775', low: '#3c9e9b', high: '#6fffe0', halo: '#27c5b4' },
};

/** Owns WebGL resources and interaction; React owns accessible controls and copy. */
export class Globe3DEngine {
  private three: typeof Three | null = null;
  private renderer: Three.WebGLRenderer | null = null;
  private scene: Three.Scene | null = null;
  private camera: Three.PerspectiveCamera | null = null;
  private globe: Three.Group | null = null;
  private land: Three.Group | null = null;
  private surface: Three.Mesh<Three.SphereGeometry, Three.MeshPhongMaterial> | null = null;
  private atmosphere: Three.Mesh<Three.SphereGeometry, Three.ShaderMaterial> | null = null;
  private grid: Three.LineSegments<Three.BufferGeometry, Three.LineBasicMaterial> | null = null;
  private raycaster: Three.Raycaster | null = null;
  private world: Region[] = [];
  private fetchController = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private frame: number | null = null;
  private destroyed = false;
  private visible = true;
  private dirty = true;
  private reducedMotion = false;
  private rotating = false;
  private dragging = false;
  private pointerId: number | null = null;
  private pointer: [number, number] | null = null;
  private lastPointer: [number, number] = [0, 0];
  private lastFrame = 0;
  private hoverKey = '';
  private targetX = 24 * RAD;
  private targetY = -105 * RAD;
  private dark = false;

  constructor(private options: Globe3DOptions) {}

  async init(): Promise<void> {
    const [THREE, world] = await Promise.all([
      import('three'), this.loadMap('/world-zh.json'),
    ]);
    if (this.destroyed) return;
    this.three = THREE;
    this.world = this.prepareRegions(world);
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.dark = document.documentElement.classList.contains('dark');
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch { throw new Error('WebGL not supported'); }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.options.container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
    this.raycaster = new THREE.Raycaster();
    this.globe = new THREE.Group();
    this.scene.add(this.globe);
    this.scene.add(new THREE.AmbientLight('#d8eeee', 1.8));
    const key = new THREE.DirectionalLight('#f0fffc', 2.8);
    key.position.set(-250, 300, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#63b6c4', 0.7);
    fill.position.set(250, -100, -150);
    this.scene.add(fill);
    // The depth-writing surface occludes every point and border on the far side.
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 96, 64), new THREE.MeshPhongMaterial({
      color: PALETTES[this.dark ? 'dark' : 'light'].ocean, shininess: 32, specular: '#142b32',
    }));
    this.globe.add(this.surface);
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.025, 64, 48), new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(PALETTES[this.dark ? 'dark' : 'light'].halo) } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vEye; void main(){vec4 p = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vEye = -p.xyz; gl_Position = projectionMatrix * p;}',
      fragmentShader: 'uniform vec3 tint; varying vec3 vNormal; varying vec3 vEye; void main(){float rim = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vEye))), 3.5); gl_FragColor = vec4(tint, rim * 0.24);}',
      transparent: true, depthWrite: false,
    }));
    this.globe.add(this.atmosphere);
    this.buildGrid();
    this.rebuildLand();
    this.resetView();
    this.globe.rotation.set(this.targetX, this.targetY, 0);
    this.setupEvents();
    this.handleResize();
    this.start();
  }

  private async loadMap(url: string): Promise<GlobeFeature[]> {
    const response = await fetch(url, { signal: this.fetchController.signal });
    if (!response.ok) throw new Error('Map request failed: ' + response.status);
    const data = await response.json() as { features: GlobeFeature[] };
    return data.features;
  }

  private prepareRegions(features: GlobeFeature[]): Region[] {
    return features.filter(feature => feature.geometry && feature.properties?.name && feature.properties.name !== '南极洲').map(feature => {
      const points = sampleLand(feature, 1.4);
      return { feature, points, id: String(feature.properties?.iso_n3 ?? ''), center: representativePoint(feature, points) };
    });
  }

  updateData(worldData: Record<string, GlobeGeoData>): void {
    this.options = { ...this.options, worldData };
    if (!this.three || this.destroyed) return;
    this.clearHover();
    this.rebuildLand();
  }

  setAutoRotate(rotating: boolean): void {
    this.rotating = rotating;
    this.options.onRotationChange?.(rotating);
    this.dirty = true;
    this.start();
  }

  resetView(): void {
    this.targetX = 24 * RAD;
    const home = -105 * RAD, current = this.globe?.rotation.y ?? home;
    this.targetY = home + Math.round((current - home) / (2 * Math.PI)) * 2 * Math.PI;
    this.clearHover();
    this.pointer = null;
    this.setAutoRotate(!this.reducedMotion);
  }

  private buildGrid(): void {
    const THREE = this.three!;
    const coordinates: number[] = [];
    const add = (a: Location, b: Location) => coordinates.push(...toSphere(...a, RADIUS + 0.08), ...toSphere(...b, RADIUS + 0.08));
    for (let lat = -60; lat <= 60; lat += 30) for (let lng = -180; lng < 180; lng += 2) add([lng, lat], [lng + 2, lat]);
    for (let lng = -180; lng < 180; lng += 30) for (let lat = -88; lat < 88; lat += 2) add([lng, lat], [lng, lat + 2]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
    this.grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: PALETTES[this.dark ? 'dark' : 'light'].grid, transparent: true, opacity: 0.13, depthWrite: false,
    }));
    this.globe!.add(this.grid);
  }

  private rebuildLand(): void {
    if (!this.three || !this.globe) return;
    const THREE = this.three;
    if (this.land) { this.globe.remove(this.land); this.disposeObject(this.land); }
    this.land = new THREE.Group();
    const palette = PALETTES[this.dark ? 'dark' : 'light'];
    const data = this.options.worldData;
    const max = viewMaximum(data);
    const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
    const lines: number[] = [], lineColors: number[] = [];
    const color = new THREE.Color();
    for (const region of this.world) {
      const value = data[region.id];
      const strength = value?.views ? Math.sqrt(Math.min(1, value.views / max)) : 0;
      color.set(palette.land);
      if (strength) color.set(palette.low).lerp(new THREE.Color(palette.high), strength);
      for (const [lng, lat] of region.points) {
        positions.push(...toSphere(lng, lat, RADIUS + 0.38));
        colors.push(color.r, color.g, color.b);
        sizes.push(1.65 + strength);
      }
      const borderColor = new THREE.Color(strength ? palette.low : palette.border);
      for (const polygon of polygonsOf(region.feature)) for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = new THREE.Vector3(...toSphere(ring[i - 1][0], ring[i - 1][1], 1));
          const b = new THREE.Vector3(...toSphere(ring[i][0], ring[i][1], 1));
          const segments = Math.max(1, Math.ceil(a.angleTo(b) / (1.5 * RAD)));
          for (let j = 0; j < segments; j++) {
            const p = a.clone().lerp(b, j / segments).normalize().multiplyScalar(RADIUS + 0.22);
            const q = a.clone().lerp(b, (j + 1) / segments).normalize().multiplyScalar(RADIUS + 0.22);
            lines.push(...p.toArray(), ...q.toArray());
            lineColors.push(borderColor.r, borderColor.g, borderColor.b, borderColor.r, borderColor.g, borderColor.b);
          }
        }
      }
      if (strength && region.center) {
        const position = new THREE.Vector3(...toSphere(...region.center, RADIUS + 0.9));
        const markerSize = 1.6 + strength * 1.7;
        const ring = new THREE.Mesh(new THREE.RingGeometry(markerSize, markerSize + 0.35, 40), new THREE.MeshBasicMaterial({
          color: palette.high, transparent: true, opacity: 0.7, depthWrite: false,
        }));
        ring.position.copy(position);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
        this.land.add(ring);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(markerSize * 0.35, 16), new THREE.MeshBasicMaterial({ color: palette.high }));
        dot.position.copy(position);
        dot.quaternion.copy(ring.quaternion);
        this.land.add(dot);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    const material = new THREE.PointsMaterial({ size: 1, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
    };
    this.land.add(new THREE.Points(geometry, material));
    const borders = new THREE.BufferGeometry();
    borders.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    borders.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    this.land.add(new THREE.LineSegments(borders, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false,
    })));
    this.globe.add(this.land);
    this.dirty = true;
  }

  private setupEvents(): void {
    const canvas = this.renderer!.domElement;
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.options.container.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.motionQuery?.addEventListener('change', this.onMotionChange);
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.options.container);
    this.themeObserver = new MutationObserver(this.onThemeChange);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if ('IntersectionObserver' in window) {
      this.visibilityObserver = new IntersectionObserver(entries => {
        this.visible = entries[0]?.isIntersecting ?? true;
        this.onVisibilityChange();
      }, { rootMargin: '80px' });
      this.visibilityObserver.observe(this.options.container);
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.lastPointer = [event.clientX, event.clientY];
    this.renderer?.domElement.setPointerCapture(event.pointerId);
    this.setAutoRotate(false);
    this.clearHover();
    if (this.renderer) this.renderer.domElement.style.cursor = 'grabbing';
    this.setPointer(event);
  };
  private setPointer(event: PointerEvent): void {
    const rect = this.options.container.getBoundingClientRect();
    this.pointer = [2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height];
    this.dirty = true;
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.setPointer(event);
    if (!this.dragging) return;
    this.targetY += (event.clientX - this.lastPointer[0]) * 0.006;
    this.targetX = Math.max(-1.2, Math.min(1.2, this.targetX + (event.clientY - this.lastPointer[1]) * 0.006));
    this.lastPointer = [event.clientX, event.clientY];
  };
  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.renderer?.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (this.renderer) this.renderer.domElement.style.cursor = 'grab';
    this.dirty = true;
  };
  private onPointerCancel = (event: PointerEvent): void => {
    this.dragging = false;
    this.pointerId = null;
    if (event.type === 'pointercancel') { this.pointer = null; this.clearHover(); }
    if (this.renderer) this.renderer.domElement.style.cursor = 'grab';
    this.dirty = true;
  };
  private onPointerLeave = (): void => {
    if (this.dragging) return;
    this.pointer = null;
    this.clearHover();
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Home') { event.preventDefault(); this.resetView(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    this.setAutoRotate(false);
    this.pointer = null;
    this.clearHover();
    this.targetY += event.key === 'ArrowLeft' ? -0.15 : event.key === 'ArrowRight' ? 0.15 : 0;
    this.targetX = Math.max(-1.2, Math.min(1.2, this.targetX + (event.key === 'ArrowUp' ? -0.12 : event.key === 'ArrowDown' ? 0.12 : 0)));
  };
  private clearHover(): void {
    this.hoverKey = '';
    this.options.onHover?.(null, 0, 0);
  }
  private pickRegion(): void {
    if (!this.pointer || this.dragging || !this.surface || !this.camera || !this.raycaster || !this.three || !this.globe) return;
    this.raycaster.setFromCamera(new this.three.Vector2(...this.pointer), this.camera);
    const hit = this.raycaster.intersectObject(this.surface)[0];
    if (!hit) { if (this.hoverKey) this.clearHover(); return; }
    const local = this.globe.worldToLocal(hit.point.clone());
    const [lng, lat] = fromSphere(local.x, local.y, local.z);
    const region = this.world.find(region => containsLocation(region.feature, lng, lat));
    if (!region) { if (this.hoverKey) this.clearHover(); return; }
    const key = region.id + ':' + this.pointer[0].toFixed(3) + ':' + this.pointer[1].toFixed(3);
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    const data = this.options.worldData[region.id];
    this.options.onHover?.({ name: region.feature.properties?.name || '', views: data?.views ?? 0, uv: data?.uv ?? 0 }, ...this.pointer);
  }
  private handleResize = (): void => {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.options.container.clientWidth);
    const height = Math.max(1, this.options.container.clientHeight);
    this.camera.aspect = width / height;
    const halfFov = this.camera.fov * RAD / 2;
    const limitingAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.camera.aspect));
    this.camera.position.z = RADIUS / Math.sin(limitingAngle) * 1.18;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.dirty = true;
  };
  private onThemeChange = (): void => {
    const dark = document.documentElement.classList.contains('dark');
    if (dark === this.dark || !this.surface || !this.atmosphere || !this.grid) return;
    this.dark = dark;
    const palette = PALETTES[dark ? 'dark' : 'light'];
    this.surface.material.color.set(palette.ocean);
    this.atmosphere.material.uniforms.tint.value.set(palette.halo);
    this.grid.material.color.set(palette.grid);
    this.rebuildLand();
  };
  private onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    if (event.matches) this.setAutoRotate(false);
  };
  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
    this.options.onError?.();
  };
  private onVisibilityChange = (): void => {
    if (document.hidden || !this.visible) this.stop();
    else { this.dirty = true; this.start(); }
  };
  private start(): void {
    if (this.destroyed || this.frame !== null || !this.renderer || !this.visible || document.hidden) return;
    this.lastFrame = 0;
    this.frame = requestAnimationFrame(this.animate);
  }
  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  private animate = (time: number): void => {
    if (this.destroyed || !this.renderer || !this.scene || !this.camera || !this.globe) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.1) : 1 / 60;
    if (this.lastFrame && delta < 1 / 32 && !this.dragging) return;
    this.lastFrame = time;
    if (this.rotating && !this.dragging && !this.hoverKey) this.targetY += delta * 0.045;
    const moving = Math.abs(this.globe.rotation.x - this.targetX) + Math.abs(this.globe.rotation.y - this.targetY) > 0.00005;
    if (!moving && !this.dirty) return;
    const smoothing = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 9);
    this.globe.rotation.x += (this.targetX - this.globe.rotation.x) * smoothing;
    this.globe.rotation.y += (this.targetY - this.globe.rotation.y) * smoothing;
    this.globe.updateMatrixWorld(true);
    this.pickRegion();
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  };
  private disposeObject(object: Three.Object3D): void {
    object.traverse(child => {
      const drawable = child as Three.Mesh;
      drawable.geometry?.dispose();
      if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) material.dispose();
    });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fetchController.abort();
    this.stop();
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.options.container.removeEventListener('keydown', this.onKeyDown);
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerCancel);
      canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.remove();
    }
    if (this.scene) this.disposeObject(this.scene);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.globe = null;
    this.world = [];
  }
}
