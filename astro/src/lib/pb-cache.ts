import type PocketBase from 'pocketbase';
import type { SendOptions } from 'pocketbase';

/**
 * PocketBase GET 响应缓存（SSR 进程与浏览器同构）
 *
 * 背景：
 * - SSR 模式下每个页面渲染都实时回源 PocketBase（列表/详情/计数），TTFB 被 PB 往返拖慢；
 * - 浏览器侧 installAdminStepUpHeaders 给每个 GET 追加 _ts 一次性参数（防 ESA 边缘缓存串数据），
 *   导致边缘缓存对 API 完全失效，客户端内存缓存是岛屿重复请求的唯一缓冲层。
 *
 * 安全边界：
 * - 仅缓存无 auth token 的匿名 GET；任何带 token 的请求直接穿透（后台/用户态数据永不进缓存）；
 * - 任何非 GET 请求成功后清空全部缓存（写后立即可见）；
 * - 失败响应不缓存；
 * - 命中时返回深拷贝，避免多个调用方共享同一对象引用被原地修改。
 */

export const PB_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  expiry: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function clone<T>(data: unknown): T {
  if (data === null || data === undefined) return data as T;
  return structuredClone(data) as T;
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiry <= now) cache.delete(key);
  }
  // 全量未过期时退化为删除最旧条目（Map 迭代序即插入序）
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 单飞（single-flight）执行：同一 key 的并发调用共享一次底层请求。 */
export async function cachedCall<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiry > Date.now()) return clone<T>(hit.data);

  const pending = inflight.get(key);
  if (pending) return clone<T>(await pending);

  const promise = fn()
    .then((data) => {
      cache.set(key, { expiry: Date.now() + ttlMs, data });
      evictIfNeeded();
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return clone<T>(await promise);
}

export function clearPbResponseCache(): void {
  cache.clear();
}

/** 测试用：当前缓存条目数。 */
export function pbCacheSize(): number {
  return cache.size;
}

/**
 * 裸 fetch 页面的缓存封装（pages/*.astro frontmatter 用）。
 * 保持调用方原有 try/catch 语义：HTTP 非 2xx 抛出，由页面兜底。
 */
export function cachedFetchJson<T = unknown>(url: string, init?: RequestInit, ttlMs = PB_CACHE_TTL_MS): Promise<T> {
  return cachedCall<T>(`GET ${url}`, ttlMs, async () => {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  });
}

// RequestInit 的键（含 SDK 扩展的 fetch/body/headers）不参与缓存 key——
// 其余顶层字段都会被 SDK 序列化为 query 参数，必须进 key。
const REQUEST_INIT_KEYS = new Set([
  'method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect',
  'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'signal', 'window',
  'fetch', 'duplex', 'priority',
]);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function sendCacheKey(path: string, options: SendOptions): string {
  const queryFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (!REQUEST_INIT_KEYS.has(key)) queryFields[key] = value;
  }
  return `pb GET ${path} ${stableStringify(queryFields)}`;
}

/**
 * 包装 PocketBase 实例的 send：匿名 GET 走 30s 缓存，写操作成功后清空缓存。
 * beforeSend（step-up 头 / _ts 防边缘缓存参数）在原 send 内部执行，不受影响；
 * 缓存命中时根本不会发起网络请求，ESA 边缘 MISS 兜底语义不被削弱。
 */
export function wrapPocketBaseSend(pb: PocketBase): void {
  const marked = pb as unknown as { __pbCacheWrapped?: boolean };
  if (marked.__pbCacheWrapped) return;
  marked.__pbCacheWrapped = true;

  const original = pb.send.bind(pb);
  pb.send = function wrappedSend<T = unknown>(path: string, options: SendOptions = {}): Promise<T> {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      return original<T>(path, options).then((res) => {
        clearPbResponseCache();
        return res;
      });
    }
    if (pb.authStore.token) {
      return original<T>(path, options);
    }
    return cachedCall<T>(sendCacheKey(path, options), PB_CACHE_TTL_MS, () => original<T>(path, options));
  } as typeof pb.send;
}
