import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'a', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h3', 'h4', 'img', 'hr'];
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'target', 'rel']);
const URL_ATTRS = new Set(['href', 'src']);

const AUTH_ATTEMPT_PREFIX = 'blog:auth-attempt:';
const DEFAULT_AUTH_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_LOCK_MS = 30 * 60 * 1000;
const DEFAULT_AUTH_MAX_ATTEMPTS = 5;

interface AuthAttemptState {
  count: number;
  first: number;
  lockedUntil: number;
}

interface AuthAttemptOptions {
  maxAttempts?: number;
  windowMs?: number;
  lockMs?: number;
}

type BeforeSendResult = RequestInit | { url?: string; options?: RequestInit } | void;
type BeforeSend = (url: string, options: RequestInit) => BeforeSendResult | Promise<BeforeSendResult>;

interface AuthHeaderClient {
  beforeSend?: BeforeSend;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!trimmed) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

  try {
    const url = new URL(trimmed, 'https://hlydwz.com');
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function sanitizeAttributes(tagName: string, rawAttributes: string): string {
  const attrs: string[] = [];
  const attrPattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rawAttributes)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (!ALLOWED_ATTRS.has(name)) continue;
    if (name.startsWith('on') || name === 'style' || name === 'srcdoc') continue;
    if (name === 'src' && tagName !== 'img') continue;
    if (name === 'href' && tagName !== 'a') continue;
    if (URL_ATTRS.has(name) && !isSafeUrl(value)) continue;
    if (name === 'target' && value !== '_blank') continue;

    attrs.push(`${name}="${escapeAttribute(value)}"`);
  }

  if (tagName === 'a' && attrs.some((attr) => attr === 'target="_blank"') && !attrs.some((attr) => attr.startsWith('rel='))) {
    attrs.push('rel="noopener noreferrer"');
  }

  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

function sanitizeHtmlFallback(html: string): string {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form|input|button|svg|math)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form|input|button|svg|math)\b[^>]*\/?>/gi, '')
    .replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (full, rawTagName: string, rawAttributes: string) => {
      const tagName = rawTagName.toLowerCase();
      if (!ALLOWED_TAGS.includes(tagName)) return '';
      if (full.startsWith('</')) return VOID_TAGS.has(tagName) ? '' : `</${tagName}>`;

      const attrs = sanitizeAttributes(tagName, rawAttributes || '');
      return VOID_TAGS.has(tagName) ? `<${tagName}${attrs}>` : `<${tagName}${attrs}>`;
    });
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function authStorageKey(key: string): string {
  return AUTH_ATTEMPT_PREFIX + encodeURIComponent(key || 'anonymous');
}

function readAuthAttemptState(key: string): AuthAttemptState {
  if (!canUseStorage()) return { count: 0, first: 0, lockedUntil: 0 };

  try {
    const raw = window.localStorage.getItem(authStorageKey(key));
    if (!raw) return { count: 0, first: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<AuthAttemptState>;
    return {
      count: Number(parsed.count) || 0,
      first: Number(parsed.first) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
  } catch {
    return { count: 0, first: 0, lockedUntil: 0 };
  }
}

function writeAuthAttemptState(key: string, state: AuthAttemptState): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(authStorageKey(key), JSON.stringify(state));
}

function normalizeBeforeSendResult(result: BeforeSendResult, url: string, options: RequestInit) {
  if (!result) return { url, options };
  if ('options' in result || 'url' in result) {
    return { url: result.url || url, options: result.options || options };
  }
  return { url, options: result };
}

/** Sanitize HTML for safe rendering */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return sanitizeHtmlFallback(html);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: Array.from(ALLOWED_ATTRS),
    ALLOW_DATA_ATTR: false,
  });
}

/** Strip all HTML tags */
export function sanitizeText(text: string): string {
  let cleaned = text.replace(/<[^>]*>/g, '');
  cleaned = cleaned.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return cleaned.trim();
}

export function normalizeAuthEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 100);
}

export function getPasswordStrength(password: string) {
  const value = String(password || '');
  const checks = [
    value.length >= 10,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];
  const score = checks.filter(Boolean).length;

  if (!value) return { score: 0, label: '未填写', ok: false };
  if (value.length < 10) return { score, label: '至少 10 个字符', ok: false };
  if (score < 4) return { score, label: '建议混合大小写、数字或符号', ok: false };
  return { score, label: score >= 5 ? '强密码' : '可用密码', ok: true };
}

/** Generate browser fingerprint for login security */
export async function getBrowserFingerprint(): Promise<string> {
  if (typeof window === 'undefined') return 'ssr';

  const parts: string[] = [
    navigator.userAgent || '',
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    navigator.language || '',
    navigator.platform || '',
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() || '',
  ];

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(100, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.font = '11pt Arial';
      ctx.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.font = '18pt Times New Roman';
      ctx.fillText('abcdefghijklmnopqrstuvwxyz', 4, 45);
      parts.push(canvas.toDataURL());
    }
  } catch { /* canvas not available */ }

  const raw = parts.join('|||');

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.substring(0, 32);
  } catch {
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const chr = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

export async function withAuthRequestHeaders<T>(client: AuthHeaderClient, run: () => Promise<T>, extraHeaders: Record<string, string> = {}): Promise<T> {
  const originalBeforeSend = client.beforeSend;
  const fingerprint = await getBrowserFingerprint();

  client.beforeSend = async (url, options) => {
    const request = normalizeBeforeSendResult(
      originalBeforeSend ? await originalBeforeSend(url, options) : undefined,
      url,
      options
    );
    const headers = new Headers(request.options.headers as HeadersInit | undefined);
    headers.set('X-Browser-Fingerprint', fingerprint);
    headers.set('X-Auth-Client-Time', new Date().toISOString());
    headers.set('X-Requested-With', 'XMLHttpRequest');
    Object.entries(extraHeaders).forEach(([name, value]) => headers.set(name, value));
    request.options.headers = Object.fromEntries(headers.entries());
    return request;
  };

  try {
    return await run();
  } finally {
    client.beforeSend = originalBeforeSend;
  }
}

export function getAuthAttemptKey(email: string): string {
  return normalizeAuthEmail(email) || 'anonymous';
}

export function getAuthLockRemainingSeconds(key: string): number {
  const state = readAuthAttemptState(key);
  const remaining = Math.ceil((state.lockedUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function setAuthLock(key: string, lockSeconds: number): number {
  const now = Date.now();
  const state = readAuthAttemptState(key);
  state.lockedUntil = now + Math.max(1, lockSeconds) * 1000;
  writeAuthAttemptState(key, state);
  return getAuthLockRemainingSeconds(key);
}

export function recordAuthFailure(key: string, options: AuthAttemptOptions = {}): number {
  const now = Date.now();
  const maxAttempts = options.maxAttempts ?? DEFAULT_AUTH_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_AUTH_WINDOW_MS;
  const lockMs = options.lockMs ?? DEFAULT_AUTH_LOCK_MS;
  const state = readAuthAttemptState(key);

  if (state.lockedUntil > now) return getAuthLockRemainingSeconds(key);

  if (!state.first || now - state.first > windowMs) {
    state.count = 0;
    state.first = now;
  }

  state.count += 1;
  if (state.count >= maxAttempts) {
    state.lockedUntil = now + lockMs;
  }

  writeAuthAttemptState(key, state);
  return getAuthLockRemainingSeconds(key);
}

export function clearAuthFailures(key: string): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(authStorageKey(key));
}

export function formatAuthLock(seconds: number): string {
  if (seconds <= 0) return '0 秒';
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes <= 0) return `${restSeconds} 秒`;
  return `${minutes} 分 ${restSeconds.toString().padStart(2, '0')} 秒`;
}

/** Client-side rate limiter (token bucket) */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxTokens = 10, refillRate = 1) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.maxTokens, this.tokens + (now - this.lastRefill) / 1000 * this.refillRate);
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
