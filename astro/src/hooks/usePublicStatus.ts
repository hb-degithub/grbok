import { useSyncExternalStore } from 'react';

/**
 * 首页公开状态的共享数据源（模块级单例 store）。
 *
 * 首页有多个区块需要同一份公开状态（StatusMini、RequestPath 等）。过去每个组件
 * 各自 `useEffect` + `setInterval`，同一页面会重复请求 `/api/public/status`、
 * `/api/public/protection`、`/api/public/ping`，并且各自维护定时器与失败态。
 * 这里把它们收敛成一份模块级 store：
 *
 * - 第一个订阅者挂载时开始加载并建立 30s 轮询，之后所有消费者共享同一份快照；
 * - 订阅引用计数归零（最后一个消费者卸载）才清理 timer / visibilitychange 监听，
 *   并中止在途请求、回到初始快照（不把上一页的数据留给下一次挂载）；
 * - 三个来源各自维护 loading / ready / failed，一个来源失败不牵连其它来源；
 * - 每次刷新分配递增的请求序号，并用 AbortController 中止上一轮请求。旧序号
 *   返回的响应一律丢弃，避免「后发先返回」用过期数据覆盖新结果；
 * - 页面 hidden 时暂停轮询、不发请求；visible 时立即刷新并恢复轮询；
 * - SSR 只返回服务端初始快照：模块顶层不访问 window / document，不发起请求，
 *   服务端渲染也不需要任何数据。
 *
 * 接口形状与 `/api/public/*` 的既有响应保持一致，只做防御性归一化，不造数据：
 * 非 2xx、解析失败、字段缺失都落到 failed / null。
 */

export type PublicStatusPhase = 'loading' | 'ready' | 'failed';
export type SafelineState = 'ok' | 'stale' | 'unavailable';

export interface PublicStatusService {
  key: string;
  ok: boolean | null;
  avgLatency24h: number | null;
  uptime24h: number | null;
}

export interface PublicStatusSnapshot {
  status: { overall?: string; services?: PublicStatusService[] } | null;
  statusPhase: PublicStatusPhase;
  protectionPhase: PublicStatusPhase;
  pingPhase: PublicStatusPhase;
  blocked24h: number | null;
  pingMs: number | null;
  safelineState: SafelineState | null;
}

const STATUS_URL = '/api/public/status';
const PROTECTION_URL = '/api/public/protection';
const PING_URL = '/api/public/ping';

/** 与 StatusMini / RequestPath 既有的刷新节奏保持一致。 */
const POLL_INTERVAL_MS = 30_000;
/** 一次「你的延迟」= 连续 3 次实测往返取均值（与既有实现一致）。 */
const PING_SAMPLE_COUNT = 3;

/** 服务端快照与客户端初始快照同源：hydration 前后文案一致。 */
const INITIAL_SNAPSHOT: PublicStatusSnapshot = Object.freeze({
  status: null,
  statusPhase: 'loading',
  protectionPhase: 'loading',
  pingPhase: 'loading',
  blocked24h: null,
  pingMs: null,
  safelineState: null,
});

let snapshot: PublicStatusSnapshot = INITIAL_SNAPSHOT;

const listeners = new Set<() => void>();

/** 轮询 timer：仅浏览器、且还有订阅者时存在。 */
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** visibilitychange 监听是否已绑定，避免重复 add / remove。 */
let visibilityBound = false;
/** 请求序号：每次刷新 +1，异步响应回来时必须与自己的序号一致才允许提交。 */
let generation = 0;
/** 本轮刷新未结束的请求；下一轮刷新或卸载时统一 abort。 */
const inflight = new Set<AbortController>();

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** 页面 hidden 时不发请求；SSR 阶段（没有 document）永远算「不可见」。 */
function isPageHidden(): boolean {
  return !isBrowser() || document.visibilityState === 'hidden';
}

function commit(patch: Partial<PublicStatusSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function clearPollTimer(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function abortInflight(): void {
  for (const controller of inflight) controller.abort();
  inflight.clear();
}

function createRequestController(): AbortController {
  const controller = new AbortController();
  inflight.add(controller);
  return controller;
}

function finishRequest(controller: AbortController): void {
  inflight.delete(controller);
}

/* ------------------------------------------------------------------ */
/* 响应归一化：只搬运可验证的字段，缺失/类型不对就是 null（不造数据）        */
/* ------------------------------------------------------------------ */

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeService(value: unknown): PublicStatusService | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== 'string' || record.key.length === 0) return null;
  return {
    key: record.key,
    ok: typeof record.ok === 'boolean' ? record.ok : null,
    avgLatency24h: readNumber(record.avgLatency24h),
    uptime24h: readNumber(record.uptime24h),
  };
}

/** `/api/public/status` 可能只给 `{ overall }`、或干脆没有 services。 */
function normalizeStatus(payload: unknown): PublicStatusSnapshot['status'] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const services = Array.isArray(record.services)
    ? record.services
        .map(normalizeService)
        .filter((service): service is PublicStatusService => service !== null)
    : undefined;
  return {
    overall: typeof record.overall === 'string' ? record.overall : undefined,
    services,
  };
}

function normalizeSafelineState(value: unknown): SafelineState | null {
  return value === 'ok' || value === 'stale' || value === 'unavailable' ? value : null;
}

function readSafeline(payload: unknown): { state: SafelineState | null; blocked: number | null } {
  if (!payload || typeof payload !== 'object') return { state: null, blocked: null };
  const safeline = (payload as { safeline?: unknown }).safeline;
  if (!safeline || typeof safeline !== 'object' || Array.isArray(safeline)) {
    return { state: null, blocked: null };
  }
  const state = normalizeSafelineState((safeline as { state?: unknown }).state);
  // 只有 state === 'ok' 的 blocked 才是可信的真实拦截数：stale 是过期快照，
  // unavailable 是采集未接入，此时数字一律不展示（与既有组件判定一致）。
  const blocked = state === 'ok' ? readNumber((safeline as { blocked?: unknown }).blocked) : null;
  return { state, blocked };
}

/* ------------------------------------------------------------------ */
/* 三个来源的加载                                                       */
/* ------------------------------------------------------------------ */

async function loadStatus(run: number): Promise<void> {
  const controller = createRequestController();
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const payload: unknown = await response.json();
    if (run !== generation) return;
    const status = normalizeStatus(payload);
    if (!status) throw new Error('invalid status payload');
    commit({ status, statusPhase: 'ready' });
  } catch {
    if (run !== generation) return;
    commit({ status: null, statusPhase: 'failed' });
  } finally {
    finishRequest(controller);
  }
}

async function loadProtection(run: number): Promise<void> {
  const controller = createRequestController();
  try {
    const response = await fetch(PROTECTION_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`protection ${response.status}`);
    const payload: unknown = await response.json();
    if (run !== generation) return;
    const { state, blocked } = readSafeline(payload);
    commit({ safelineState: state, blocked24h: blocked, protectionPhase: 'ready' });
  } catch {
    if (run !== generation) return;
    // 防护统计是可选增强：失败时状态与数字都归 null，不保留过期值。
    commit({ safelineState: null, blocked24h: null, protectionPhase: 'failed' });
  } finally {
    finishRequest(controller);
  }
}

async function loadPing(run: number): Promise<void> {
  const controller = createRequestController();
  const samples: number[] = [];
  try {
    for (let i = 0; i < PING_SAMPLE_COUNT; i += 1) {
      if (run !== generation) return;
      const startedAt = performance.now();
      try {
        const response = await fetch(`${PING_URL}?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        // 非 2xx 的往返时间不是链路时延（可能是错误页/网关超时），不能作为样本。
        if (!response.ok) continue;
        samples.push(performance.now() - startedAt);
      } catch {
        if (run !== generation) return;
        // 单次失败跳过，继续采后面的样本。
      }
    }
    if (run !== generation) return;
    if (samples.length > 0) {
      const average = samples.reduce((total, sample) => total + sample, 0) / samples.length;
      commit({ pingMs: Math.round(average), pingPhase: 'ready' });
    } else {
      commit({ pingMs: null, pingPhase: 'failed' });
    }
  } finally {
    finishRequest(controller);
  }
}

/** 并发刷新三个来源；上一轮在途请求先中止，序号继续递增。 */
function refreshAll(): void {
  if (!isBrowser() || isPageHidden()) return;
  abortInflight();
  generation += 1;
  const run = generation;
  void loadStatus(run);
  void loadProtection(run);
  void loadPing(run);
}

/* ------------------------------------------------------------------ */
/* 轮询与可见性                                                         */
/* ------------------------------------------------------------------ */

function schedulePoll(): void {
  clearPollTimer();
  if (isPageHidden()) return;
  pollTimer = setInterval(() => {
    refreshAll();
  }, POLL_INTERVAL_MS);
}

function handleVisibilityChange(): void {
  if (isPageHidden()) {
    // hidden：停掉轮询，避免后台标签页继续打接口。
    clearPollTimer();
    return;
  }
  // visible：立即补一次刷新（不是等下一个周期），然后恢复轮询。
  refreshAll();
  schedulePoll();
}

function start(): void {
  if (!isBrowser() || visibilityBound) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  visibilityBound = true;
  refreshAll();
  schedulePoll();
}

function stop(): void {
  if (visibilityBound && isBrowser()) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  visibilityBound = false;
  clearPollTimer();
  // 卸载后回来的一切异步结果都不再属于任何消费者：序号作废并中止在途请求。
  generation += 1;
  abortInflight();
  // 最后一个消费者卸载后回到初始快照，下一次挂载从 loading 开始，
  // 不会把上一页的旧数据（或旧失败态）带给新挂载的组件。
  snapshot = INITIAL_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): PublicStatusSnapshot {
  return snapshot;
}

function getServerSnapshot(): PublicStatusSnapshot {
  return INITIAL_SNAPSHOT;
}

/**
 * 订阅首页公开状态快照。多个消费者共享同一份请求与轮询；
 * 组件只读快照，不直接接触 timer / fetch。
 */
export function usePublicStatus(): PublicStatusSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
